import { GeometryModel, LineRef } from "./types.js";

function lineKey(line: LineRef): string {
  return [line.a, line.b].sort().join("");
}

function uniqBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(keyOf(item), item);
  }
  return [...map.values()];
}

export function enrichModelForV2(model: GeometryModel): GeometryModel {
  const enriched: GeometryModel = {
    ...model,
    points: [...model.points],
    segments: [...model.segments],
    circles: [...model.circles],
    triangles: [...model.triangles],
    midpoints: [...model.midpoints],
    pointsOnSegments: [...model.pointsOnSegments],
    parallels: [...model.parallels],
    perpendiculars: [...model.perpendiculars],
    altitudes: [...model.altitudes],
    medians: [...model.medians],
    angleBisectors: [...model.angleBisectors],
    tangents: [...model.tangents],
    incircles: [...model.incircles],
    circumcircles: [...model.circumcircles],
    rectangles: [...model.rectangles],
    squares: [...model.squares],
    parallelograms: [...model.parallelograms],
    trapezoids: [...model.trapezoids],
    circlesByDiameter: [...model.circlesByDiameter],
    pointsOnCircles: [...model.pointsOnCircles],
    namedTangents: [...model.namedTangents],
    perpendicularThroughPointIntersections: [...model.perpendicularThroughPointIntersections],
    tangentIntersections: [...model.tangentIntersections]
  };

  for (const alt of enriched.altitudes) {
    enriched.pointsOnSegments.push({ point: alt.foot, a: alt.baseA, b: alt.baseB });
    enriched.perpendiculars.push({
      line1: { a: alt.from, b: alt.foot },
      line2: { a: alt.baseA, b: alt.baseB }
    });
  }

  for (const md of enriched.medians) {
    enriched.midpoints.push({ point: md.foot, a: md.baseA, b: md.baseB });
    enriched.pointsOnSegments.push({ point: md.foot, a: md.baseA, b: md.baseB });
  }

  for (const nt of enriched.namedTangents) {
    if (nt.center) {
      enriched.tangents.push({ at: nt.at, circleCenter: nt.center });
      enriched.perpendiculars.push({
        line1: { a: nt.at, b: nt.center },
        line2: { a: nt.at, b: nt.linePoint }
      });
    }
  }

  for (const tg of enriched.tangents) {
    if (tg.circleCenter) {
      const helper = `t_${tg.at}`;
      enriched.points.push(helper);
      enriched.perpendiculars.push({
        line1: { a: tg.at, b: tg.circleCenter },
        line2: { a: tg.at, b: helper }
      });
    }
  }

  for (const c of enriched.perpendicularThroughPointIntersections) {
    enriched.perpendiculars.push({
      line1: { a: c.through, b: c.intersection },
      line2: { a: c.toLine.a, b: c.toLine.b }
    });
  }

  for (const cb of enriched.circlesByDiameter) {
    if (!cb.centerId) {
      continue;
    }
    enriched.pointsOnCircles.push({ point: cb.a, center: cb.centerId });
    enriched.pointsOnCircles.push({ point: cb.b, center: cb.centerId });
  }

  for (const ab of enriched.angleBisectors) {
    enriched.points.push(ab.from, ab.foot, ab.sideA, ab.sideB);
  }

  enriched.points = uniqBy(enriched.points, (p) => p);
  enriched.pointsOnSegments = uniqBy(
    enriched.pointsOnSegments,
    (it) => `${it.point}:${lineKey({ a: it.a, b: it.b })}`
  );
  enriched.midpoints = uniqBy(
    enriched.midpoints,
    (it) => `${it.point}:${lineKey({ a: it.a, b: it.b })}`
  );
  enriched.perpendiculars = uniqBy(
    enriched.perpendiculars,
    (it) => `${lineKey(it.line1)}:${lineKey(it.line2)}`
  );
  enriched.tangents = uniqBy(
    enriched.tangents,
    (it) => `${it.at}:${it.circleCenter ?? ""}`
  );
  enriched.pointsOnCircles = uniqBy(
    enriched.pointsOnCircles,
    (it) => `${it.point}:${it.center}`
  );

  return enriched;
}
