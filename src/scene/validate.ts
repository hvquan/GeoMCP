/**
 * scene/validate.ts — SceneGraph structural validation.
 *
 * Checks that all references (point ids, geometry ids) are declared.
 * Returns errors (blocking) and warnings (non-blocking).
 */
import type { SceneGraph, ValidatedScene, ValidationError } from "./schema.js";

export function validate(scene: SceneGraph): ValidatedScene {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  const pointIds = new Set(scene.points.map((p) => p.id));
  const geoIds   = new Set(scene.geometry.map((g) => g.id));

  const checkPoint = (id: string, path: string) => {
    if (!pointIds.has(id))
      errors.push({ message: `Unknown point id "${id}"`, path });
  };
  const checkGeo = (id: string, path: string) => {
    if (!geoIds.has(id))
      errors.push({ message: `Unknown geometry id "${id}"`, path });
  };

  for (const [i, node] of scene.geometry.entries()) {
    if (node.kind === "segment") {
      checkPoint(node.a, `geometry[${i}].a`);
      checkPoint(node.b, `geometry[${i}].b`);
    } else if (node.kind === "ray") {
      checkPoint(node.originPoint, `geometry[${i}].originPoint`);
      if ('throughPoint' in node && node.throughPoint)
        checkPoint(node.throughPoint, `geometry[${i}].throughPoint`);
    } else if (node.kind === "line") {
      if ('a' in node && node.a) {
        checkPoint(node.a, `geometry[${i}].a`);
        checkPoint(node.b, `geometry[${i}].b`);
      } else if ('throughPointId' in node && node.throughPointId) {
        checkPoint(node.throughPointId, `geometry[${i}].throughPointId`);
      }
    } else if (node.kind === "circle") {
      checkPoint(node.center, `geometry[${i}].center`);
      if (node.radius <= 0)
        errors.push({ message: `Circle radius must be > 0`, path: `geometry[${i}].radius` });
    } else if (node.kind === "triangle") {
      if (node.points.length !== 3)
        errors.push({ message: `Triangle must have exactly 3 points`, path: `geometry[${i}].points` });
      node.points.forEach((pid, j) => checkPoint(pid, `geometry[${i}].points[${j}]`));
    } else if (node.kind === "polygon") {
      if (node.points.length < 3)
        errors.push({ message: `Polygon must have at least 3 points`, path: `geometry[${i}].points` });
      node.points.forEach((pid, j) => checkPoint(pid, `geometry[${i}].points[${j}]`));
    }
  }

  for (const [i, m] of scene.angleMarks.entries())
    m.points.forEach((pid, j) => checkPoint(pid, `angleMarks[${i}].points[${j}]`));

  for (const [i, m] of scene.rightAngleMarks.entries()) {
    checkPoint(m.pointId, `rightAngleMarks[${i}].pointId`);
    checkGeo(m.line1Id,   `rightAngleMarks[${i}].line1Id`);
    checkGeo(m.line2Id,   `rightAngleMarks[${i}].line2Id`);
  }

  for (const [i, m] of scene.segmentMarks.entries()) {
    checkPoint(m.a, `segmentMarks[${i}].a`);
    checkPoint(m.b, `segmentMarks[${i}].b`);
  }

  for (const [i, lbl] of (scene.labels ?? []).entries()) {
    if (!pointIds.has(lbl.targetId) && !geoIds.has(lbl.targetId))
      errors.push({ message: `Unknown targetId "${lbl.targetId}"`, path: `labels[${i}].targetId` });
  }

  const seen = new Set<string>();
  for (const p of scene.points) {
    if (seen.has(p.id)) warnings.push(`Duplicate point id "${p.id}"`);
    seen.add(p.id);
  }

  return { scene, errors, warnings };
}
