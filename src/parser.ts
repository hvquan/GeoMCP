import {
  AltitudeConstraint,
  AngleBisectorConstraint,
  Circle,
  CircleByDiameterConstraint,
  CircumcircleConstraint,
  GeometryModel,
  IncircleConstraint,
  MedianConstraint,
  MidpointConstraint,
  NamedTangentConstraint,
  ParallelogramConstraint,
  ParallelConstraint,
  PerpendicularThroughPointIntersectionConstraint,
  PerpendicularConstraint,
  PointOnCircleConstraint,
  PointOnSegmentConstraint,
  RectangleConstraint,
  SquareConstraint,
  Segment,
  TangentIntersectionConstraint,
  TangentConstraint,
  TrapezoidConstraint,
  Triangle,
  Line,
  LineIntersectionConstraint,
  PerpendicularLinesConstraint,
  CircleConstraint,
  DiameterConstraint
} from "./types.js";

const pointRegex = /\b([A-Z])\b/g;
const triangleRegex = /(tam\s*gi[aá]c|triangle)\s*([A-Z]{3})/gi;
const rightTriangleRegex = /(tam\s*gi[aá]c\s*vu[oô]ng|right\s*triangle)\s*([A-Z]{3})(\s*(t[aạ]i|at)\s*([A-Z]))?/gi;
const rightAtRegex = /(vu[oô]ng\s+t[aạ]i|right\s+at)\s*([A-Z])/gi;
const isoscelesAtRegex = /(c[aâ]n\s+t[aạ]i|isosceles\s+at)\s*([A-Z])/gi;
const equilateralRegex = /(tam\s*gi[aá]c\s+[A-Z]{3}\s+(đ[eề]u|deu)|equilateral\s+triangle)/gi;
const segmentLengthRegex = /\b([A-Z])([A-Z])\s*=\s*(\d+(?:\.\d+)?)/g;
const circleRegex = /(đường\s*tr[oò]n|duong\s*tron|circle).*?(t[aâ]m|tam|center)\s*([A-Z]).*?(b[aá]n\s*k[ií]nh|ban\s*kinh|radius)\s*(\d+(?:\.\d+)?)/gi;
const midpointRegex = /\b([A-Z])\s+(l[aà]\s+)?(trung\s*đi[eể]m|trung\s*diem|midpoint)\s+(c[ủu]a|of)\s+([A-Z])([A-Z])/gi;
const pointOnSegmentRegex = /\b([A-Z])\s+(thu[oộ]c|n[aằ]m\s+tr[eê]n|on)\s+(đo[aạ]n\s*)?([A-Z])([A-Z])/gi;

const parallelRegex = /(đường\s*thẳng\s*|duong\s*thang\s*)?([A-Z])([A-Z])\s*(song\s*song|songsong|parallel\s*to)\s*(v[oớ]i\s*)?([A-Z])([A-Z])/gi;
const perpendicularRegex = /(đường\s*thẳng\s*|duong\s*thang\s*)?([A-Z])([A-Z])\s*(vu[oô]ng\s*g[oó]c|vuong\s*goc|vuonggoc|perpendicular\s*to|perp)\s*(v[oớ]i\s*)?([A-Z])([A-Z])/gi;
const altitudeRegex = /(đường\s*cao|duong\s*cao|altitude).*?(t[ừu]|tu|from)\s*([A-Z]).*?(xu[oố]ng|xuong|to)\s*(đo[aạ]n\s*|doan\s*)?([A-Z])([A-Z]).*?(t[aạ]i|tai|at)\s*([A-Z])/gi;
const medianRegex = /(trung\s*tuy[eế]n|trung\s*tuyen|median).*?(t[ừu]|tu|from)\s*([A-Z]).*?(đ[eế]n|den|to)\s*(trung\s*đi[eể]m\s*|trung\s*diem\s*)?([A-Z])/gi;
const angleBisectorRegex = /(ph[aâ]n\s*gi[aá]c|phan\s*giac|angle\s*bisector).*?(c[ủu]a\s*g[oó]c|cua\s*goc|of\s*angle)\s*([A-Z])([A-Z])([A-Z]).*?(c[aắ]t|cat|intersect)\s*(đo[aạ]n\s*|doan\s*)?([A-Z])([A-Z]).*?(t[aạ]i|tai|at)\s*([A-Z])/gi;
const tangentAtPointRegex = /(ti[eế]p\s*tuy[eế]n|tiep\s*tuyen|tangent).*?(t[aạ]i|tai|at)\s*([A-Z]).*?(c[ủu]a|cua|of)\s*(đường\s*tr[oò]n|duong\s*tron|circle).*?(t[aâ]m|tam|center)\s*([A-Z])/gi;
const incircleRegex = /(đường\s*tr[oò]n\s*n[oộ]i\s*ti[eế]p|duong\s*tron\s*noi\s*tiep|incircle)(\s*tam\s*gi[aá]c\s*([A-Z]{3}))?/gi;
const circumcircleRegex = /(đường\s*tr[oò]n\s*ngo[aạ]i\s*ti[eế]p|duong\s*tron\s*ngoai\s*tiep|circumcircle)(\s*tam\s*gi[aá]c\s*([A-Z]{3}))?/gi;
const rectangleRegex = /(h[iì]nh\s*ch[ữu]\s*nh[aạ]t|rectangle)\s*([A-Z]{4})/gi;
const squareRegex = /(h[iì]nh\s*vu[oô]ng|square)\s*([A-Z]{4})/gi;
const parallelogramRegex = /(h[iì]nh\s*b[iì]nh\s*h[aà]nh|parallelogram)\s*([A-Z]{4})/gi;
const trapezoidRegex = /(h[iì]nh\s*thang|trapezoid)\s*([A-Z]{4})/gi;
const circleByDiameterRegex = /(đường\s*tr[oò]n|duong\s*tron|circle).*?(đường\s*k[ií]nh|duong\s*kinh|diameter)\s*([A-Z])([A-Z])/gi;
const circleWithCenterAndDiameterRegex = /(đường\s*tr[oò]n|duong\s*tron|circle)\s*\(?([A-Z])\)?.*?(đường\s*k[ií]nh|duong\s*kinh|diameter)\s*\(?([A-Z])([A-Z])\)?/gi;
const pointOnCircleRegex = /\b([A-Z])\s+(thuoc|n[aằ]m\s*tren|on)\s+(đường\s*tr[oò]n|duong\s*tron|circle)\s*\(?([A-Z])\)?/gi;
const namedTangentRegex = /(ti[eế]p\s*tuy[eế]n|tiep\s*tuyen|tangent)\s*(t[aạ]i|tai|at)\s*\(?([A-Z])\)?.*?(l[aà]|la|is)?\s*(đường\s*thẳng|duong\s*thang|line)?\s*\(?([A-Z])([A-Za-z])\)?/gi;
const namedTangentShortRegex = /(ti[eế]p\s*tuy[eế]n|tiep\s*tuyen|tangent)\s*(t[aạ]i|tai|at)\s*\(?([A-Z])\)?.*?\(?\3([A-Za-z])\)?/gi;
const perpThroughPointToLineCutLineRegex = /(qua|through)\s*\(?([A-Z])\)?.*?(vu[oô]ng\s*g[oó]c|vuong\s*goc|perpendicular)\s*(v[oớ]i|to)?\s*\(?([A-Z])([A-Z])\)?.*?(c[aắ]t|cat|intersect)\s*\(?([A-Z])([A-Za-z])\)?\s*(t[aạ]i|tai|at)\s*\(?([A-Z])\)?/gi;
const tangentThroughPointRegex = /(qua|through)\s*\(?([A-Z])\)?[^.]*?(tiep\s*tuyen|ti[eế]p\s*tuy[eế]n|tangent)/gi;
const tangentThroughPointCutLineRegex = /(qua|through)\s*\(?([A-Z])\)?[^.]*?(tiep\s*tuyen|ti[eế]p\s*tuy[eế]n|tangent)[^.]*?(c[aắ]t|cat|intersect)\s*\(?([A-Z])([A-Z])\)?\s*(t[aạ]i|tai|at)\s*\(?([A-Z])\)?/gi;
const tangentReferenceCutLineRegex = /(tiep\s*tuyen\s*n[aà]y|this\s*tangent).*?(c[aắ]t|cat|intersect)\s*\(?([A-Z])([A-Z])\)?\s*(t[aạ]i|tai|at)\s*\(?([A-Z])\)?/gi;
const perpendicularAtPointRegex = /\(?([A-Z])([A-Z])\)?\s*(vu[oô]ng\s*g[oó]c|vuong\s*goc|perpendicular|perp)\s*\(?([A-Z])([A-Z])\)?\s*(t[aạ]i|tai|at)\s*\(?([A-Z])\)?/gi;

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function uniqSegments(segments: Segment[]): Segment[] {
  const map = new Map<string, Segment>();
  for (const s of segments) {
    const key = [s.a, s.b].sort().join("");
    const prev = map.get(key);
    if (!prev || (prev.length == null && s.length != null)) {
      map.set(key, s);
    }
  }
  return [...map.values()];
}

function uniqByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const it of items) {
    map.set(keyOf(it), it);
  }
  return [...map.values()];
}

function normalizeVietnamese(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function preprocessMathNotation(input: string): string {
  return input
    .replace(/\\perp|⊥|⟂/gi, " vuong goc ")
    .replace(/\\parallel|∥/gi, " song song ")
    .replace(/\\ne|≠/gi, " khac ")
    .replace(/\\[()\[\]{}]/g, " ")
    .replace(/[\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pointId(token: string | undefined): string {
  const t = (token ?? "").trim();
  return /^[A-Z]$/.test(t) ? t : "";
}

function pointIdLoose(token: string | undefined): string {
  const t = (token ?? "").trim();
  return /^[A-Za-z]$/.test(t) ? t.toUpperCase() : "";
}

function hasPoints(...ids: string[]): boolean {
  return ids.every((id) => /^[A-Z]$/.test(id));
}

function parseTriangleToken(token: string | undefined): [string, string, string] | undefined {
  if (!token || token.length !== 3) {
    return undefined;
  }
  if (!/^[A-Z]{3}$/.test(token)) {
    return undefined;
  }
  const chars = token.toUpperCase().split("") as [string, string, string];
  return chars;
}

function parseQuadrilateralToken(
  token: string | undefined
): [string, string, string, string] | undefined {
  if (!token || token.length !== 4) {
    return undefined;
  }
  if (!/^[A-Z]{4}$/.test(token)) {
    return undefined;
  }
  return token.toUpperCase().split("") as [string, string, string, string];
}

export function parseGeometryProblem(text: string): GeometryModel {
  const preprocessedText = preprocessMathNotation(text);
  const normalizedText = normalizeVietnamese(preprocessedText);
  const sources = [preprocessedText, normalizedText];

  const points: string[] = [];
  const segments: Segment[] = [];
  const circles: Circle[] = [];
  const triangles: Triangle[] = [];
  const midpoints: MidpointConstraint[] = [];
  const pointsOnSegments: PointOnSegmentConstraint[] = [];
  const parallels: ParallelConstraint[] = [];
  const perpendiculars: PerpendicularConstraint[] = [];
  const altitudes: AltitudeConstraint[] = [];
  const medians: MedianConstraint[] = [];
  const angleBisectors: AngleBisectorConstraint[] = [];
  const tangents: TangentConstraint[] = [];
  const incircles: IncircleConstraint[] = [];
  const circumcircles: CircumcircleConstraint[] = [];
  const rectangles: RectangleConstraint[] = [];
  const squares: SquareConstraint[] = [];
  const parallelograms: ParallelogramConstraint[] = [];
  const trapezoids: TrapezoidConstraint[] = [];
  const circlesByDiameter: CircleByDiameterConstraint[] = [];
  const pointsOnCircles: PointOnCircleConstraint[] = [];
  const circleConstraints: CircleConstraint[] = [];
  const diameterConstraints: DiameterConstraint[] = [];
  const namedTangents: NamedTangentConstraint[] = [];
  const lines: Line[] = [];
  const lineIntersections: LineIntersectionConstraint[] = [];
  const perpendicularLines: PerpendicularLinesConstraint[] = [];
  const perpendicularThroughPointIntersections: PerpendicularThroughPointIntersectionConstraint[] = [];
  const tangentIntersections: TangentIntersectionConstraint[] = [];

  for (const m of normalizedText.matchAll(pointRegex)) {
    points.push(pointId(m[1]));
  }

  for (const source of sources) {
    for (const m of source.matchAll(triangleRegex)) {
      const tri = parseTriangleToken(m[2]);
      if (!tri) {
        continue;
      }
      triangles.push({ vertices: tri });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(rightTriangleRegex)) {
      const tri = parseTriangleToken(m[2]);
      if (!tri) {
        continue;
      }

      const rightAt = pointId(m[5]) || tri[0];
      triangles.push({ vertices: tri, rightAt });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(rightAtRegex)) {
      const p = pointId(m[2]);
      if (!p) {
        continue;
      }
      if (triangles.length > 0) {
        const t = triangles[triangles.length - 1];
        t.rightAt = p;
      }
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(isoscelesAtRegex)) {
      const p = pointId(m[2]);
      if (!p) {
        continue;
      }
      if (triangles.length > 0) {
        const t = triangles[triangles.length - 1];
        t.isoscelesAt = p;
      }
    }
  }

  for (const source of sources) {
    for (const _ of source.matchAll(equilateralRegex)) {
      if (triangles.length > 0) {
        const t = triangles[triangles.length - 1];
        t.equilateral = true;
      }
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(segmentLengthRegex)) {
      const a = pointId(m[1]);
      const b = pointId(m[2]);
      if (!hasPoints(a, b)) {
        continue;
      }
      const length = Number(m[3]);
      segments.push({ a, b, length });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(circleRegex)) {
      const center = pointId(m[3]);
      if (!center) {
        continue;
      }
      const radius = Number(m[5]);
      points.push(center);
      circles.push({ center, radius });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(midpointRegex)) {
      const point = pointId(m[1]);
      const a = pointId(m[5]);
      const b = pointId(m[6]);
      if (!hasPoints(point, a, b)) {
        continue;
      }
      points.push(point, a, b);
      midpoints.push({ point, a, b });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(pointOnSegmentRegex)) {
      const point = pointId(m[1]);
      const a = pointId(m[4]);
      const b = pointId(m[5]);
      if (!hasPoints(point, a, b)) {
        continue;
      }
      points.push(point, a, b);
      pointsOnSegments.push({ point, a, b });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(parallelRegex)) {
      const a = pointId(m[2]);
      const b = pointId(m[3]);
      const c = pointId(m[6]);
      const d = pointId(m[7]);
      if (!hasPoints(a, b, c, d)) {
        continue;
      }
      points.push(a, b, c, d);
      parallels.push({ line1: { a, b }, line2: { a: c, b: d } });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(perpendicularRegex)) {
      const a = pointId(m[2]);
      const b = pointId(m[3]);
      const c = pointId(m[6]);
      const d = pointId(m[7]);
      if (!hasPoints(a, b, c, d)) {
        continue;
      }
      points.push(a, b, c, d);
      perpendiculars.push({ line1: { a, b }, line2: { a: c, b: d } });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(altitudeRegex)) {
      const from = pointId(m[3]);
      const baseA = pointId(m[6]);
      const baseB = pointId(m[7]);
      const foot = pointId(m[9]);
      if (!hasPoints(from, baseA, baseB, foot)) {
        continue;
      }
      points.push(from, baseA, baseB, foot);
      altitudes.push({ from, foot, baseA, baseB });
      pointsOnSegments.push({ point: foot, a: baseA, b: baseB });
      perpendiculars.push({
        line1: { a: from, b: foot },
        line2: { a: baseA, b: baseB }
      });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(medianRegex)) {
      const from = pointId(m[3]);
      const foot = pointId(m[6]);
      if (!hasPoints(from, foot)) {
        continue;
      }
      points.push(from, foot);
      if (triangles.length > 0) {
        const tri = triangles[triangles.length - 1].vertices;
        const base = tri.filter((v) => v !== from);
        if (base.length === 2) {
          medians.push({ from, foot, baseA: base[0], baseB: base[1] });
          midpoints.push({ point: foot, a: base[0], b: base[1] });
        }
      }
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(angleBisectorRegex)) {
      const sideA = pointId(m[3]);
      const from = pointId(m[4]);
      const sideB = pointId(m[5]);
      const baseA = pointId(m[8]);
      const baseB = pointId(m[9]);
      const foot = pointId(m[11]);
      if (!hasPoints(sideA, from, sideB, baseA, baseB, foot)) {
        continue;
      }
      points.push(sideA, from, sideB, baseA, baseB, foot);
      angleBisectors.push({ from, foot, sideA, sideB });
      pointsOnSegments.push({ point: foot, a: baseA, b: baseB });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(tangentAtPointRegex)) {
      const at = pointId(m[3]);
      const circleCenter = pointId(m[7]);
      if (!hasPoints(at, circleCenter)) {
        continue;
      }
      points.push(at, circleCenter);
      const circleId = `c_${circleCenter}`;
      tangents.push({ circleId, pointId: at, pointOnCircle: true });
      perpendiculars.push({ line1: { a: at, b: circleCenter }, line2: { a: at, b: `t_${at}` } });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(incircleRegex)) {
      const tri = parseTriangleToken(m[4]);
      incircles.push({ triangle: tri });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(circumcircleRegex)) {
      const tri = parseTriangleToken(m[4]);
      circumcircles.push({ triangle: tri });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(rectangleRegex)) {
      const quad = parseQuadrilateralToken(m[2]);
      if (!quad) {
        continue;
      }
      points.push(...quad);
      rectangles.push({ vertices: quad });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(squareRegex)) {
      const quad = parseQuadrilateralToken(m[2]);
      if (!quad) {
        continue;
      }
      points.push(...quad);
      squares.push({ vertices: quad });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(parallelogramRegex)) {
      const quad = parseQuadrilateralToken(m[2]);
      if (!quad) {
        continue;
      }
      points.push(...quad);
      parallelograms.push({ vertices: quad });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(trapezoidRegex)) {
      const quad = parseQuadrilateralToken(m[2]);
      if (!quad) {
        continue;
      }
      points.push(...quad);
      trapezoids.push({ vertices: quad });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(circleByDiameterRegex)) {
      const a = pointId(m[3]);
      const b = pointId(m[4]);
      if (!hasPoints(a, b)) {
        continue;
      }
      points.push(a, b);
      circlesByDiameter.push({ a, b });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(circleWithCenterAndDiameterRegex)) {
      const centerId = pointId(m[2]);
      const a = pointId(m[4]);
      const b = pointId(m[5]);
      if (!hasPoints(centerId, a, b)) {
        continue;
      }
      points.push(centerId, a, b);
      circlesByDiameter.push({ a, b, centerId });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(pointOnCircleRegex)) {
      const point = pointId(m[1]);
      const center = pointId(m[4]);
      if (!hasPoints(point, center)) {
        continue;
      }
      points.push(point, center);
      pointsOnCircles.push({ point, center });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(namedTangentRegex)) {
      const at = pointId(m[3]);
      const lineA = pointId(m[6]);
      const lineB = pointIdLoose(m[7]);
      if (!hasPoints(at, lineA, lineB) || lineA !== at) {
        continue;
      }
      points.push(at, lineB);
      namedTangents.push({ at, linePoint: lineB });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(namedTangentShortRegex)) {
      const at = pointId(m[3]);
      const lineB = pointIdLoose(m[4]);
      if (!hasPoints(at, lineB)) {
        continue;
      }
      points.push(at, lineB);
      namedTangents.push({ at, linePoint: lineB });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(perpThroughPointToLineCutLineRegex)) {
      const through = pointId(m[2]);
      const toA = pointId(m[5]);
      const toB = pointId(m[6]);
      const withA = pointId(m[8]);
      const withB = pointIdLoose(m[9]);
      const intersection = pointId(m[11]);
      if (!hasPoints(through, toA, toB, withA, withB, intersection)) {
        continue;
      }

      points.push(through, toA, toB, withA, withB, intersection);
      
      // Generate line ids and create line objects
      const lineToId = `l${lines.length + 1}`;
      const lineWithId = `l${lines.length + 2}`;
      
      // Line through toA-toB (e.g., CE)
      lines.push({
        id: lineToId,
        a: toA,
        b: toB
      });
      
      // Line through withA-withB (e.g., tangent Cx)
      lines.push({
        id: lineWithId,
        a: withA,
        b: withB
      });
      
      // Line through "through" perpendicular to the "to" line (e.g., line through O perpendicular to CE)
      const perpLineId = `l${lines.length + 1}`;
      lines.push({
        id: perpLineId,
        through,
        perpendicularTo: { a: toA, b: toB }
      });
      
      // Constraint: the perpendicular line intersects with line at intersection point
      lineIntersections.push({
        line1: perpLineId,
        line2: lineWithId,
        point: intersection
      });
      
      // Constraint: perpendicular line is perpendicular to the "to" line
      perpendicularLines.push({
        line1: perpLineId,
        line2: lineToId
      });
      
      // Keep old constraint for backwards compatibility
      perpendicularThroughPointIntersections.push({
        through,
        toLine: { a: toA, b: toB },
        withLine: { a: withA, b: withB },
        intersection
      });
      perpendiculars.push({ line1: { a: through, b: intersection }, line2: { a: toA, b: toB } });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(tangentThroughPointCutLineRegex)) {
      const at = pointId(m[2]);
      const withA = pointId(m[4]);
      const withB = pointId(m[5]);
      const intersection = pointId(m[7]);
      if (!hasPoints(at, withA, withB, intersection)) {
        continue;
      }
      points.push(at, withA, withB, intersection);
      tangentIntersections.push({ at, withLine: { a: withA, b: withB }, intersection });
    }
  }

  for (const source of sources) {
    const tangentAnchors: string[] = [];
    for (const m of source.matchAll(tangentThroughPointRegex)) {
      const at = pointId(m[2]);
      if (at) {
        tangentAnchors.push(at);
      }
    }

    for (const m of source.matchAll(tangentReferenceCutLineRegex)) {
      const at = tangentAnchors[tangentAnchors.length - 1] ?? "";
      const withA = pointId(m[3]);
      const withB = pointId(m[4]);
      const intersection = pointId(m[6]);
      if (!hasPoints(at, withA, withB, intersection)) {
        continue;
      }
      points.push(at, withA, withB, intersection);
      tangentIntersections.push({ at, withLine: { a: withA, b: withB }, intersection });
    }
  }

  for (const source of sources) {
    for (const m of source.matchAll(perpendicularAtPointRegex)) {
      const a = pointId(m[1]);
      const b = pointId(m[2]);
      const c = pointId(m[4]);
      const d = pointId(m[5]);
      const at = pointId(m[7]);
      if (!hasPoints(a, b, c, d, at)) {
        continue;
      }
      points.push(a, b, c, d, at);
      perpendiculars.push({ line1: { a, b }, line2: { a: c, b: d } });
      pointsOnSegments.push({ point: at, a: c, b: d });
    }
  }

  // Generate circle and diameter constraints from circlesByDiameter and pointsOnCircles
  for (const cbd of circlesByDiameter) {
    if (cbd.centerId) {
      const circleId = `c_${cbd.centerId}`;
      diameterConstraints.push({
        circleId,
        point1Id: cbd.a,
        point2Id: cbd.b
      });
      circleConstraints.push({
        circleId,
        centerPointId: cbd.centerId,
        pointOnCircleId: cbd.a
      });
    }
  }

  for (const poc of pointsOnCircles) {
    const circleId = `c_${poc.center}`;
    circleConstraints.push({
      circleId,
      centerPointId: poc.center,
      pointOnCircleId: poc.point
    });
  }

  return {
    rawText: text,
    points: uniq(points),
    segments: uniqSegments(segments),
    circles,
    triangles: uniqByKey(
      triangles,
      (it) => `${it.vertices.join("")}:${it.rightAt ?? ""}:${it.isoscelesAt ?? ""}:${it.equilateral ? "1" : "0"}`
    ),
    midpoints: uniqByKey(midpoints, (it) => `${it.point}:${[it.a, it.b].sort().join("")}`),
    pointsOnSegments: uniqByKey(
      pointsOnSegments,
      (it) => `${it.point}:${[it.a, it.b].sort().join("")}`
    ),
    parallels: uniqByKey(
      parallels,
      (it) => `${[it.line1.a, it.line1.b].sort().join("")}:${[it.line2.a, it.line2.b].sort().join("")}`
    ),
    perpendiculars: uniqByKey(
      perpendiculars,
      (it) => `${[it.line1.a, it.line1.b].sort().join("")}:${[it.line2.a, it.line2.b].sort().join("")}`
    ),
    altitudes: uniqByKey(
      altitudes,
      (it) => `${it.from}:${it.foot}:${[it.baseA, it.baseB].sort().join("")}`
    ),
    medians: uniqByKey(
      medians,
      (it) => `${it.from}:${it.foot}:${[it.baseA, it.baseB].sort().join("")}`
    ),
    angleBisectors: uniqByKey(
      angleBisectors,
      (it) => `${it.from}:${it.foot}:${it.sideA}:${it.sideB}`
    ),
    tangents: uniqByKey(
      tangents,
      (it) => `${it.circleId}:${it.pointId}:${it.pointOnCircle ? "1" : "0"}`
    ),
    incircles: uniqByKey(
      incircles,
      (it) => `I:${it.triangle?.join("") ?? ""}`
    ),
    circumcircles: uniqByKey(
      circumcircles,
      (it) => `O:${it.triangle?.join("") ?? ""}`
    ),
    rectangles: uniqByKey(rectangles, (it) => it.vertices.join("")),
    squares: uniqByKey(squares, (it) => it.vertices.join("")),
    parallelograms: uniqByKey(parallelograms, (it) => it.vertices.join("")),
    trapezoids: uniqByKey(trapezoids, (it) => it.vertices.join("")),
    circlesByDiameter: uniqByKey(
      circlesByDiameter,
      (it) => `${[it.a, it.b].sort().join("")}`
    ),
    pointsOnCircles: uniqByKey(
      pointsOnCircles,
      (it) => `${it.point}:${it.center}`
    ),
    circleConstraints: uniqByKey(
      circleConstraints,
      (it) => `${it.circleId}:${it.centerPointId}:${it.pointOnCircleId}`
    ),
    diameterConstraints: uniqByKey(
      diameterConstraints,
      (it) => `${it.circleId}:${[it.point1Id, it.point2Id].sort().join(":")}`
    ),
    namedTangents: uniqByKey(
      namedTangents,
      (it) => `${it.at}:${it.linePoint}:${it.center ?? ""}`
    ),
    lines: uniqByKey(
      lines,
      (it) => `${it.id}`
    ),
    lineIntersections: uniqByKey(
      lineIntersections,
      (it) => `${[it.line1, it.line2].sort().join(":")}:${it.point}`
    ),
    perpendicularLines: uniqByKey(
      perpendicularLines,
      (it) => `${[it.line1, it.line2].sort().join(":")}`
    ),
    perpendicularThroughPointIntersections: uniqByKey(
      perpendicularThroughPointIntersections,
      (it) => `${it.through}:${it.toLine.a}${it.toLine.b}:${it.withLine.a}${it.withLine.b}:${it.intersection}`
    ),
    tangentIntersections: uniqByKey(
      tangentIntersections,
      (it) => `${it.at}:${it.withLine.a}${it.withLine.b}:${it.intersection}`
    )
  };
}
