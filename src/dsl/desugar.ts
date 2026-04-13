/**
 * DSL Desugaring Pass
 *
 * Expands high-level macro objects (isosceles_triangle, rectangle, etc.) into
 * primitive objects and constraints that the construction compiler understands.
 * This is a pure syntactic lowering step — no geometry solving happens here.
 */
import type { GeometryDsl, DslObject, DslConstraint } from "./dsl.js";
import { asPointId } from "./dsl.js";

type PointPair = [string, string];
type PointTriple = [string, string, string];
type PointQuad = [string, string, string, string];

function triangleAngleAt(points: PointTriple, vertex: string): PointTriple {
  const normalized = points.map(asPointId) as PointTriple;
  const at = asPointId(vertex);
  if (normalized[0] === at) {
    return [normalized[1], normalized[0], normalized[2]];
  }
  if (normalized[1] === at) {
    return [normalized[0], normalized[1], normalized[2]];
  }
  return [normalized[0], normalized[2], normalized[1]];
}

function quadrilateralEdges(points: PointQuad): [PointPair, PointPair, PointPair, PointPair] {
  const [a, b, c, d] = points.map(asPointId) as PointQuad;
  return [[a, b], [b, c], [c, d], [d, a]];
}

function cloneDsl(dsl: GeometryDsl): GeometryDsl {
  return {
    objects: [...(dsl.objects ?? [])],
    constraints: [...(dsl.constraints ?? [])],
    constructions: [...(dsl.constructions ?? [])],
    targets: [...(dsl.targets ?? [])]
  };
}

export function expandDslMacros(dsl: GeometryDsl): GeometryDsl {
  const expanded = cloneDsl(dsl);
  const nextObjects: DslObject[] = [];
  const nextConstraints: DslConstraint[] = [...expanded.constraints];

  for (const obj of expanded.objects) {
    if (obj.type === "isosceles_triangle") {
      const pts = obj.points.map(asPointId) as PointTriple;
      const apex = asPointId(obj.at ?? pts[0]);
      const angle = triangleAngleAt(pts, apex);
      nextObjects.push({ type: "triangle", name: obj.name, points: pts });
      nextConstraints.push({ type: "equal_length", segments: [[angle[1], angle[0]], [angle[1], angle[2]]] });
      continue;
    }

    if (obj.type === "equilateral_triangle") {
      const pts = obj.points.map(asPointId) as PointTriple;
      nextObjects.push({ type: "triangle", name: obj.name, points: pts });
      nextConstraints.push({ type: "equal_length", segments: [[pts[0], pts[1]], [pts[1], pts[2]]] });
      nextConstraints.push({ type: "equal_length", segments: [[pts[1], pts[2]], [pts[2], pts[0]]] });
      continue;
    }

    if (obj.type === "right_triangle") {
      const pts = obj.points.map(asPointId) as PointTriple;
      const rightAt = asPointId(obj.rightAt ?? pts[0]);
      nextObjects.push({ type: "triangle", name: obj.name, points: pts });
      nextConstraints.push({ type: "right_angle", points: triangleAngleAt(pts, rightAt) });
      continue;
    }

    if (obj.type === "right_isosceles_triangle") {
      const pts = obj.points.map(asPointId) as PointTriple;
      const apex = asPointId(obj.at ?? pts[0]);
      const angle = triangleAngleAt(pts, apex);
      nextObjects.push({ type: "triangle", name: obj.name, points: pts });
      nextConstraints.push({ type: "right_angle", points: angle });
      nextConstraints.push({ type: "equal_length", segments: [[angle[1], angle[0]], [angle[1], angle[2]]] });
      continue;
    }

    if (obj.type === "parallelogram") {
      const pts = obj.points.map(asPointId) as PointQuad;
      const [ab, bc, cd, da] = quadrilateralEdges(pts);
      nextObjects.push({ type: "polygon", name: obj.name, points: pts });
      nextConstraints.push({ type: "parallel", line1: `${ab[0]}${ab[1]}`, line2: `${cd[0]}${cd[1]}` });
      nextConstraints.push({ type: "parallel", line1: `${bc[0]}${bc[1]}`, line2: `${da[0]}${da[1]}` });
      continue;
    }

    if (obj.type === "rectangle") {
      const pts = obj.points.map(asPointId) as PointQuad;
      const [ab, bc, cd, da] = quadrilateralEdges(pts);
      nextObjects.push({ type: "polygon", name: obj.name, points: pts });
      nextConstraints.push({ type: "parallel", line1: `${ab[0]}${ab[1]}`, line2: `${cd[0]}${cd[1]}` });
      nextConstraints.push({ type: "parallel", line1: `${bc[0]}${bc[1]}`, line2: `${da[0]}${da[1]}` });
      nextConstraints.push({ type: "right_angle", points: [ab[0], ab[1], bc[1]] });
      continue;
    }

    if (obj.type === "rhombus") {
      const pts = obj.points.map(asPointId) as PointQuad;
      const [ab, bc, cd, da] = quadrilateralEdges(pts);
      nextObjects.push({ type: "polygon", name: obj.name, points: pts });
      nextConstraints.push({ type: "parallel", line1: `${ab[0]}${ab[1]}`, line2: `${cd[0]}${cd[1]}` });
      nextConstraints.push({ type: "parallel", line1: `${bc[0]}${bc[1]}`, line2: `${da[0]}${da[1]}` });
      nextConstraints.push({ type: "equal_length", segments: [ab, bc] });
      continue;
    }

    if (obj.type === "square") {
      const pts = obj.points.map(asPointId) as PointQuad;
      const [ab, bc, cd, da] = quadrilateralEdges(pts);
      nextObjects.push({ type: "polygon", name: obj.name, points: pts });
      nextConstraints.push({ type: "parallel", line1: `${ab[0]}${ab[1]}`, line2: `${cd[0]}${cd[1]}` });
      nextConstraints.push({ type: "parallel", line1: `${bc[0]}${bc[1]}`, line2: `${da[0]}${da[1]}` });
      nextConstraints.push({ type: "right_angle", points: [ab[0], ab[1], bc[1]] });
      nextConstraints.push({ type: "equal_length", segments: [ab, bc] });
      continue;
    }

    if (obj.type === "trapezoid") {
      const pts = obj.points.map(asPointId) as PointQuad;
      const [ab, , cd] = quadrilateralEdges(pts);
      nextObjects.push({ type: "polygon", name: obj.name, points: pts });
      nextConstraints.push({ type: "parallel", line1: `${ab[0]}${ab[1]}`, line2: `${cd[0]}${cd[1]}` });
      continue;
    }

    if (obj.type === "isosceles_trapezoid") {
      const pts = obj.points.map(asPointId) as PointQuad;
      const [ab, bc, cd, da] = quadrilateralEdges(pts);
      nextObjects.push({ type: "polygon", name: obj.name, points: pts });
      nextConstraints.push({ type: "parallel", line1: `${ab[0]}${ab[1]}`, line2: `${cd[0]}${cd[1]}` });
      nextConstraints.push({ type: "equal_length", segments: [bc, da] });
      continue;
    }

    if (obj.type === "kite") {
      const pts = obj.points.map(asPointId) as PointQuad;
      const [ab, bc, cd, da] = quadrilateralEdges(pts);
      nextObjects.push({ type: "polygon", name: obj.name, points: pts });
      nextConstraints.push({ type: "equal_length", segments: [ab, da] });
      nextConstraints.push({ type: "equal_length", segments: [bc, cd] });
      continue;
    }

    nextObjects.push(obj);
  }

  return {
    objects: nextObjects,
    constraints: nextConstraints,
    constructions: expanded.constructions,
    targets: expanded.targets
  };
}
