import { Circle, GeometryModel, LayoutModel, Point, Segment, Triangle } from "./types.js";

function lengthOf(segments: Segment[], a: string, b: string): number | undefined {
  for (const s of segments) {
    if ((s.a === a && s.b === b) || (s.a === b && s.b === a)) {
      return s.length;
    }
  }
  return undefined;
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function setPoint(map: Map<string, Point>, id: string, x: number, y: number): void {
  map.set(id, { id, x, y });
}

function getPoint(map: Map<string, Point>, id: string): Point | undefined {
  return map.get(id);
}

function addSegmentUnique(segments: Segment[], s: Segment): void {
  const exists = segments.some(
    (it) => (it.a === s.a && it.b === s.b) || (it.a === s.b && it.b === s.a)
  );
  if (!exists) {
    segments.push(s);
  }
}

function projectPointToLine(p: Point, a: Point, b: Point): Point {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  return { id: "", x: a.x + t * vx, y: a.y + t * vy };
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

function lineIntersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point
): Point | undefined {
  const x1 = a1.x;
  const y1 = a1.y;
  const x2 = a2.x;
  const y2 = a2.y;
  const x3 = b1.x;
  const y3 = b1.y;
  const x4 = b2.x;
  const y4 = b2.y;

  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-9) {
    return undefined;
  }

  const px =
    ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den;
  const py =
    ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den;

  return { id: "", x: px, y: py };
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
    ab = side;
    ac = side;
    bc = side;
  }

  if (triangle.isoscelesAt === a) {
    if (ab == null && ac != null) {
      ab = ac;
    }
    if (ac == null && ab != null) {
      ac = ab;
    }
  }

  if (triangle.isoscelesAt === b) {
    if (ab == null && bc != null) {
      ab = bc;
    }
    if (bc == null && ab != null) {
      bc = ab;
    }
  }

  if (triangle.isoscelesAt === c) {
    if (ac == null && bc != null) {
      ac = bc;
    }
    if (bc == null && ac != null) {
      bc = ac;
    }
  }

  if (triangle.rightAt && [a, b, c].includes(triangle.rightAt)) {
    const r = triangle.rightAt;
    const p = [a, b, c].find((it) => it !== r) as string;
    const q = [a, b, c].find((it) => it !== r && it !== p) as string;

    const rp = lengthOf(model.segments, r, p) ?? 4;
    const rq = lengthOf(model.segments, r, q) ?? 3;

    setPoint(points, r, 0, 0);
    setPoint(points, p, rp, 0);
    setPoint(points, q, 0, rq);
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
      diagnostics.push(
        `Do dai canh cua tam giac ${a}${b}${c} khong hop le (vi pham bat dang thuc tam giac).`
      );
      setPoint(points, c, safeAB / 2, safeAC * 0.8);
      return;
    }

    const y = Math.sqrt(Math.max(0, ySquared));
    setPoint(points, c, x, y);
    return;
  }

  setPoint(points, a, 0, 0);
  setPoint(points, b, safeAB, 0);
  setPoint(points, c, safeAB / 2, safeAC * 0.9);
}

function placeRectangle(vertices: [string, string, string, string], points: Map<string, Point>): void {
  const [a, b, c, d] = vertices;
  setPoint(points, a, 0, 0);
  setPoint(points, b, 6, 0);
  setPoint(points, c, 6, 4);
  setPoint(points, d, 0, 4);
}

function placeSquare(vertices: [string, string, string, string], points: Map<string, Point>): void {
  const [a, b, c, d] = vertices;
  setPoint(points, a, 0, 0);
  setPoint(points, b, 5, 0);
  setPoint(points, c, 5, 5);
  setPoint(points, d, 0, 5);
}

function placeParallelogram(vertices: [string, string, string, string], points: Map<string, Point>): void {
  const [a, b, c, d] = vertices;
  setPoint(points, a, 0, 0);
  setPoint(points, b, 6, 0);
  setPoint(points, d, 2, 4);
  setPoint(points, c, 8, 4);
}

function placeTrapezoid(vertices: [string, string, string, string], points: Map<string, Point>): void {
  const [a, b, c, d] = vertices;
  setPoint(points, a, 0, 0);
  setPoint(points, b, 8, 0);
  setPoint(points, d, 2, 4);
  setPoint(points, c, 6, 4);
}

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

  if (model.squares.length > 0) {
    placeSquare(model.squares[0].vertices, points);
    return;
  }

  if (model.rectangles.length > 0) {
    placeRectangle(model.rectangles[0].vertices, points);
    return;
  }

  if (model.parallelograms.length > 0) {
    placeParallelogram(model.parallelograms[0].vertices, points);
    return;
  }

  if (model.trapezoids.length > 0) {
    placeTrapezoid(model.trapezoids[0].vertices, points);
    return;
  }

  const inferred = model.segments.slice(0, 3).flatMap((s) => [s.a, s.b]);
  const uniq = [...new Set(inferred)].slice(0, 3);
  if (uniq.length === 3) {
    const tri: Triangle = { vertices: [uniq[0], uniq[1], uniq[2]] };
    placeTriangle(tri, model, points, diagnostics);
  }
}

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
    const foot = getPoint(points, bis.foot);

    if (!v || !a || !b || !foot) {
      diagnostics.push(`Chua du diem de dung phan giac tu ${bis.from} den ${bis.foot}.`);
      continue;
    }

    const vaLen = dist(v, a) || 1;
    const vbLen = dist(v, b) || 1;
    const ux1 = (a.x - v.x) / vaLen;
    const uy1 = (a.y - v.y) / vaLen;
    const ux2 = (b.x - v.x) / vbLen;
    const uy2 = (b.y - v.y) / vbLen;
    const dx = ux1 + ux2;
    const dy = uy1 + uy2;
    const norm = Math.sqrt(dx * dx + dy * dy) || 1;
    const dirX = dx / norm;
    const dirY = dy / norm;

    const projectedLength = (foot.x - v.x) * dirX + (foot.y - v.y) * dirY;
    const t = projectedLength > 0 ? projectedLength : 2.5;
    setPoint(points, bis.foot, v.x + dirX * t, v.y + dirY * t);
  }
}

function ensureLinePoint(
  line: { a: string; b: string },
  points: Map<string, Point>
): void {
  if (points.has(line.a) && points.has(line.b)) {
    return;
  }

  const anchor = getPoint(points, line.a) ?? getPoint(points, line.b);
  const missing = points.has(line.a) ? line.b : line.a;
  if (!anchor) {
    return;
  }
  setPoint(points, missing, anchor.x + 2, anchor.y + 1);
}

function applyParallelPerpendicular(
  model: GeometryModel,
  points: Map<string, Point>,
  diagnostics: string[]
): void {
  // Build a set of diameter endpoints that shouldn't be moved
  const diameterPoints = new Set<string>();
  for (const dc of model.circlesByDiameter) {
    diameterPoints.add(dc.a);
    diameterPoints.add(dc.b);
  }

  for (const rel of model.parallels) {
    // Skip if either endpoint is a diameter endpoint
    if (diameterPoints.has(rel.line1.a) || diameterPoints.has(rel.line1.b) ||
        diameterPoints.has(rel.line2.a) || diameterPoints.has(rel.line2.b)) {
      continue;
    }

    ensureLinePoint(rel.line1, points);
    ensureLinePoint(rel.line2, points);

    const a = getPoint(points, rel.line1.a);
    const b = getPoint(points, rel.line1.b);
    const c = getPoint(points, rel.line2.a);
    const d = getPoint(points, rel.line2.b);
    if (!a || !b || !c || !d) {
      continue;
    }

    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len = Math.sqrt(vx * vx + vy * vy) || 1;
    const target = dist(c, d) || len;
    setPoint(points, rel.line2.b, c.x + (vx / len) * target, c.y + (vy / len) * target);
  }

  for (const rel of model.perpendiculars) {
    ensureLinePoint(rel.line1, points);
    ensureLinePoint(rel.line2, points);

    const a = getPoint(points, rel.line1.a);
    const b = getPoint(points, rel.line1.b);
    const c = getPoint(points, rel.line2.a);
    const d = getPoint(points, rel.line2.b);
    if (!a || !b || !c || !d) {
      continue;
    }

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

    if (diameterPoints.has(rel.line1.a) || diameterPoints.has(rel.line1.b)) {
      continue;
    }

    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const pvx = -vy;
    const pvy = vx;
    const plen = Math.sqrt(pvx * pvx + pvy * pvy) || 1;
    const target = dist(c, d) || 2;
    setPoint(points, rel.line2.b, c.x + (pvx / plen) * target, c.y + (pvy / plen) * target);
  }
}

function applyNamedTangents(
  model: GeometryModel,
  points: Map<string, Point>,
  diagnostics: string[]
): void {
  for (const nt of model.namedTangents) {
    const at = getPoint(points, nt.at);
    const centerId = nt.center ?? model.circlesByDiameter[0]?.centerId ?? "O";
    const center = getPoint(points, centerId);
    if (!at || !center) {
      diagnostics.push(`Chua du diem de dung tiep tuyen dat ten qua ${nt.at}.`);
      continue;
    }

    const vx = at.x - center.x;
    const vy = at.y - center.y;
    const pvx = vy;
    const pvy = -vx;
    const plen = Math.sqrt(pvx * pvx + pvy * pvy) || 1;
    const len = 20;
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
    const toA = getPoint(points, c.toLine.a);
    const toB = getPoint(points, c.toLine.b);
    const withA = getPoint(points, c.withLine.a);
    const withB = getPoint(points, c.withLine.b);
    if (!through || !toA || !toB || !withA || !withB) {
      diagnostics.push(`Khong du du lieu de dung giao diem ${c.intersection}.`);
      continue;
    }

    const vx = toB.x - toA.x;
    const vy = toB.y - toA.y;
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
  diagnostics: string[]
): void {
  for (const c of model.tangentIntersections) {
    ensureLinePoint(c.withLine, points);

    const at = getPoint(points, c.at);
    const center = getPoint(points, "O") ?? getPoint(points, model.circlesByDiameter[0]?.centerId ?? "");
    const withA = getPoint(points, c.withLine.a);
    const withB = getPoint(points, c.withLine.b);
    if (!at || !center || !withA || !withB) {
      diagnostics.push(`Chua du du lieu de dung tiep tuyen qua ${c.at} cat ${c.withLine.a}${c.withLine.b}.`);
      continue;
    }

    const vx = at.x - center.x;
    const vy = at.y - center.y;
    const tangentDir = { id: "", x: at.x - vy, y: at.y + vx };
    const inter = lineIntersection(at, tangentDir, withA, withB);
    if (!inter) {
      diagnostics.push(`Khong tinh duoc giao diem ${c.intersection} cho tiep tuyen qua ${c.at}.`);
      continue;
    }

    // Near-parallel lines can yield numerically huge intersections that collapse the whole SVG scale.
    const di = dist(inter, at);
    if (!Number.isFinite(di) || di > 60) {
      const dx = tangentDir.x - at.x;
      const dy = tangentDir.y - at.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const approx = {
        x: at.x + (dx / len) * 10,
        y: at.y + (dy / len) * 10
      };
      setPoint(points, c.intersection, approx.x, approx.y);
      diagnostics.push(
        `Giao diem ${c.intersection} duoc xap xi vi hai duong gan song song (tranh vo cuc so).`
      );
      continue;
    }

    setPoint(points, c.intersection, inter.x, inter.y);
  }
}

function extendTangentIntersectionRays(
  model: GeometryModel,
  points: Map<string, Point>
): void {
  for (const item of model.tangentIntersections) {
    const at = getPoint(points, item.at);
    const intersection = getPoint(points, item.intersection);
    if (!at || !intersection) {
      continue;
    }

    const dx = intersection.x - at.x;
    const dy = intersection.y - at.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const extra = Math.max(4, len * 4);
    const helperId = `_tan_${item.at}_${item.intersection}`;

    setPoint(
      points,
      helperId,
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
    const center = getPoint(points, pc.center);
    const circle = circles.find((c) => c.center === pc.center);
    if (!center || !circle) {
      diagnostics.push(`Khong xac dinh duoc duong tron tam ${pc.center} cho diem ${pc.point}.`);
      continue;
    }

    const current = getPoint(points, pc.point);
    if (current) {
      const vx = current.x - center.x;
      const vy = current.y - center.y;
      const len = Math.sqrt(vx * vx + vy * vy) || 1;
      setPoint(points, pc.point, center.x + (vx / len) * circle.radius, center.y + (vy / len) * circle.radius);
      continue;
    }

    const hasDiameterBase = model.circlesByDiameter.some(
      (dc) => (dc.centerId ?? "O") === pc.center
    );
    const angle = hasDiameterBase
      ? (2 * Math.PI) / 3 + index * (Math.PI / 6)
      : (index / Math.max(1, model.pointsOnCircles.length)) * Math.PI * 2 + Math.PI / 8;
    index += 1;
    setPoint(
      points,
      pc.point,
      center.x + Math.cos(angle) * circle.radius,
      center.y + Math.sin(angle) * circle.radius
    );
  }
}

function deriveIncircle(
  tri: [string, string, string],
  points: Map<string, Point>
): Circle | undefined {
  const a = getPoint(points, tri[0]);
  const b = getPoint(points, tri[1]);
  const c = getPoint(points, tri[2]);
  if (!a || !b || !c) {
    return undefined;
  }

  const sideA = dist(b, c);
  const sideB = dist(a, c);
  const sideC = dist(a, b);
  const p = sideA + sideB + sideC || 1;

  const ix = (sideA * a.x + sideB * b.x + sideC * c.x) / p;
  const iy = (sideA * a.y + sideB * b.y + sideC * c.y) / p;

  const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const area = area2 / 2;
  const s = p / 2;
  const r = s > 0 ? area / s : 1;

  return { center: "I", radius: Math.max(r, 0.2) };
}

function deriveCircumcircle(
  tri: [string, string, string],
  points: Map<string, Point>
): Circle | undefined {
  const a = getPoint(points, tri[0]);
  const b = getPoint(points, tri[1]);
  const c = getPoint(points, tri[2]);
  if (!a || !b || !c) {
    return undefined;
  }

  const midAB = { id: "", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const midAC = { id: "", x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };

  const nAB = { id: "", x: midAB.x - (b.y - a.y), y: midAB.y + (b.x - a.x) };
  const nAC = { id: "", x: midAC.x - (c.y - a.y), y: midAC.y + (c.x - a.x) };

  const o = lineIntersection(midAB, nAB, midAC, nAC);
  if (!o) {
    return undefined;
  }

  const r = dist(o, a);
  return { center: "O", radius: Math.max(r, 0.2) };
}

function applySpecialCircles(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  diagnostics: string[]
): void {
  for (const c of model.circles) {
    if (!points.has(c.center)) {
      diagnostics.push(`Khong tim thay tam ${c.center} cho duong tron.`);
      continue;
    }
    circles.push(c);
  }

  let diameterIndex = 1;
  for (const dc of model.circlesByDiameter) {
    const centerId = dc.centerId ?? `Od${diameterIndex}`;
    diameterIndex += 1;

    const centerExists = points.has(centerId);
    const aExists = points.has(dc.a);
    const bExists = points.has(dc.b);

    if (centerExists && !aExists && !bExists) {
      // Center exists, place endpoints as diameter 180° apart
      const center = getPoint(points, centerId) as Point;
        const radius = 6; // default radius
      setPoint(points, dc.a, center.x - radius, center.y);
      setPoint(points, dc.b, center.x + radius, center.y);
      circles.push({ center: centerId, radius });
    } else {
      // Place endpoints, then compute center
      if (!aExists) {
          setPoint(points, dc.a, -6, 0);
      }
      if (!bExists) {
          setPoint(points, dc.b, 6, 0);
      }

      const a = getPoint(points, dc.a) as Point;
      const b = getPoint(points, dc.b) as Point;

      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      setPoint(points, centerId, cx, cy);
      circles.push({ center: centerId, radius: dist(a, b) / 2 });
    }
  }

  for (const ic of model.incircles) {
    const tri = ic.triangle ?? model.triangles[0]?.vertices;
    if (!tri) {
      diagnostics.push("Khong xac dinh duoc tam giac de dung duong tron noi tiep.");
      continue;
    }
    const c = deriveIncircle(tri, points);
    if (!c) {
      diagnostics.push("Khong du du lieu de dung duong tron noi tiep.");
      continue;
    }
    const triPts = tri.map((id) => getPoint(points, id));
    if (triPts.some((p) => !p)) {
      diagnostics.push("Khong du du lieu de dung duong tron noi tiep.");
      continue;
    }
    const a = triPts[0] as Point;
    const b = triPts[1] as Point;
    const cc = triPts[2] as Point;
    const sideA = dist(b, cc);
    const sideB = dist(a, cc);
    const sideC = dist(a, b);
    const p = sideA + sideB + sideC || 1;
    const ix = (sideA * a.x + sideB * b.x + sideC * cc.x) / p;
    const iy = (sideA * a.y + sideB * b.y + sideC * cc.y) / p;
    setPoint(points, "I", ix, iy);
    circles.push(c);
  }

  for (const oc of model.circumcircles) {
    const tri = oc.triangle ?? model.triangles[0]?.vertices;
    if (!tri) {
      diagnostics.push("Khong xac dinh duoc tam giac de dung duong tron ngoai tiep.");
      continue;
    }
    const c = deriveCircumcircle(tri, points);
    if (!c) {
      diagnostics.push("Khong du du lieu de dung duong tron ngoai tiep.");
      continue;
    }

    const a = getPoint(points, tri[0]);
    const b = getPoint(points, tri[1]);
    const cc = getPoint(points, tri[2]);
    if (!a || !b || !cc) {
      diagnostics.push("Khong du du lieu de dung duong tron ngoai tiep.");
      continue;
    }

    const midAB = { id: "", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const midAC = { id: "", x: (a.x + cc.x) / 2, y: (a.y + cc.y) / 2 };
    const nAB = { id: "", x: midAB.x - (b.y - a.y), y: midAB.y + (b.x - a.x) };
    const nAC = { id: "", x: midAC.x - (cc.y - a.y), y: midAC.y + (cc.x - a.x) };
    const o = lineIntersection(midAB, nAB, midAC, nAC);
    if (!o) {
      diagnostics.push("Khong tinh duoc tam duong tron ngoai tiep (tam giac suy bien)." );
      continue;
    }

    setPoint(points, "O", o.x, o.y);
    circles.push(c);
  }
}

function applyTangents(
  model: GeometryModel,
  points: Map<string, Point>,
  segments: Segment[],
  diagnostics: string[]
): void {
  let tangentIndex = 1;
  for (const tg of model.tangents) {
    const p = getPoint(points, tg.at);
    const centerId = tg.circleCenter ?? model.circles[0]?.center ?? "I";
    const center = getPoint(points, centerId);
    if (!p || !center) {
      diagnostics.push(`Chua du diem de dung tiep tuyen tai ${tg.at}.`);
      continue;
    }

    const vx = p.x - center.x;
    const vy = p.y - center.y;
    const perp = { x: -vy, y: vx };
    const plen = Math.sqrt(perp.x * perp.x + perp.y * perp.y) || 1;
    const scale = 2.5;

    const tid = `T${tangentIndex}`;
    tangentIndex += 1;
    setPoint(points, tid, p.x + (perp.x / plen) * scale, p.y + (perp.y / plen) * scale);
    addSegmentUnique(segments, { a: tg.at, b: tid });
  }
}

function placeUnusedPoints(all: string[], points: Map<string, Point>): void {
  const missing = all.filter((id) => !points.has(id));
  let i = 0;

  for (const id of missing) {
    const angle = (i / Math.max(1, missing.length)) * Math.PI * 2;
    setPoint(points, id, 3 * Math.cos(angle), 3 * Math.sin(angle));
    i += 1;
  }
}

export function buildLayout(model: GeometryModel): LayoutModel {
  const points = new Map<string, Point>();
  const diagnostics: string[] = [];
  const circles: Circle[] = [];

  ensureBaseShape(model, points, diagnostics);
  applyMidpoints(model, points, diagnostics);
  applyAltitudes(model, points, diagnostics);
  applyMedians(model, points, diagnostics);
  applyAngleBisectors(model, points, diagnostics);

  applySpecialCircles(model, points, circles, diagnostics);
  applyPointsOnCircles(model, points, circles, diagnostics);
  applyNamedTangents(model, points, diagnostics);
  applyPerpendicularThroughPointIntersections(model, points, diagnostics);
  applyTangentIntersections(model, points, diagnostics);
  extendTangentIntersectionRays(model, points);
  applyParallelPerpendicular(model, points, diagnostics);
  applyPointOnSegment(model, points, diagnostics);

  placeUnusedPoints(model.points, points);

  const orderedPoints = [...points.values()];
  const pointSet = new Set(orderedPoints.map((p) => p.id));
  const segments: Segment[] = model.segments.filter(
    (s) => pointSet.has(s.a) && pointSet.has(s.b)
  );

  if (model.triangles.length > 0) {
    const [a, b, c] = model.triangles[0].vertices;
    addSegmentUnique(segments, { a, b, length: lengthOf(model.segments, a, b) });
    addSegmentUnique(segments, { a, b: c, length: lengthOf(model.segments, a, c) });
    addSegmentUnique(segments, { a: b, b: c, length: lengthOf(model.segments, b, c) });
  }

  for (const mp of model.midpoints) {
    addSegmentUnique(segments, { a: mp.a, b: mp.point });
    addSegmentUnique(segments, { a: mp.point, b: mp.b });
  }

  for (const rel of model.pointsOnSegments) {
    addSegmentUnique(segments, { a: rel.a, b: rel.point });
    addSegmentUnique(segments, { a: rel.point, b: rel.b });
  }

  for (const alt of model.altitudes) {
    addSegmentUnique(segments, { a: alt.from, b: alt.foot });
  }

  for (const md of model.medians) {
    addSegmentUnique(segments, { a: md.from, b: md.foot });
  }

  for (const bis of model.angleBisectors) {
    addSegmentUnique(segments, { a: bis.from, b: bis.foot });
  }

  for (const rel of model.parallels) {
    addSegmentUnique(segments, { a: rel.line1.a, b: rel.line1.b });
    addSegmentUnique(segments, { a: rel.line2.a, b: rel.line2.b });
  }

  for (const rel of model.perpendiculars) {
    if (!rel.line2.b.startsWith("t_")) {
      addSegmentUnique(segments, { a: rel.line1.a, b: rel.line1.b });
      addSegmentUnique(segments, { a: rel.line2.a, b: rel.line2.b });
    }
  }

  for (const item of model.rectangles) {
    const [a, b, c, d] = item.vertices;
    addSegmentUnique(segments, { a, b });
    addSegmentUnique(segments, { a: b, b: c });
    addSegmentUnique(segments, { a: c, b: d });
    addSegmentUnique(segments, { a: d, b: a });
  }

  for (const item of model.squares) {
    const [a, b, c, d] = item.vertices;
    addSegmentUnique(segments, { a, b });
    addSegmentUnique(segments, { a: b, b: c });
    addSegmentUnique(segments, { a: c, b: d });
    addSegmentUnique(segments, { a: d, b: a });
  }

  for (const item of model.parallelograms) {
    const [a, b, c, d] = item.vertices;
    addSegmentUnique(segments, { a, b });
    addSegmentUnique(segments, { a: b, b: c });
    addSegmentUnique(segments, { a: c, b: d });
    addSegmentUnique(segments, { a: d, b: a });
  }

  for (const item of model.trapezoids) {
    const [a, b, c, d] = item.vertices;
    addSegmentUnique(segments, { a, b });
    addSegmentUnique(segments, { a: b, b: c });
    addSegmentUnique(segments, { a: c, b: d });
    addSegmentUnique(segments, { a: d, b: a });
  }

  for (const nt of model.namedTangents) {
    addSegmentUnique(segments, { a: nt.at, b: nt.linePoint });
  }

  for (const c of model.perpendicularThroughPointIntersections) {
    addSegmentUnique(segments, { a: c.through, b: c.intersection });
  }

  for (const c of model.tangentIntersections) {
    const helperId = `_tan_${c.at}_${c.intersection}`;
    addSegmentUnique(segments, { a: c.at, b: points.has(helperId) ? helperId : c.intersection });
    addSegmentUnique(segments, { a: c.withLine.a, b: c.intersection });
    addSegmentUnique(segments, { a: c.withLine.b, b: c.intersection });
  }

  applyTangents(model, points, segments, diagnostics);

  return {
    points: [...points.values()],
    segments,
    circles,
    diagnostics
  };
}
