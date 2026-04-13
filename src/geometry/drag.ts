/**
 * Drag Handler — interactive re-solve for a single moved point.
 *
 * When the user drags a point in the interactive editor the full pipeline does
 * not need to re-run from scratch.  All points already exist; we only need to:
 *
 *   1. Copy the current solved positions into a mutable map.
 *   2. Update the dragged point to the new cursor position.
 *   3. Re-derive analytically-determined circles (incircle, circumcircle, etc.)
 *      and re-apply all positional / relational constraints.
 *   4. Persist the converged on-circle angles back into the model.
 *   5. Rebuild the scene graph and return a fresh LayoutModel.
 *
 * This avoids the "seed missing points" overhead of the initial `solveConstraints`
 * call and produces a new LayoutModel suitable for `renderSvg`.
 */

import { Circle, GeometryModel, LayoutModel, Point } from "../model/types.js";
import { reSolveConstraints, updateAngleParametersFromSolvedPositions } from "./constraint-solver.js";
import { buildSceneGraph } from "../render/scene-graph.js";
import { CircleNode } from "../model/types.js";

/**
 * Apply a drag — move `draggedPointId` to `(newX, newY)` in SVG/math coordinates,
 * re-solve all constraints, and return a new `LayoutModel` with updated positions.
 *
 * @param model          The geometry model (constraints, unchanged).
 * @param layout         The previously solved layout (source of current positions).
 * @param draggedPointId The `id` of the point being dragged.
 * @param newX           New X coordinate (same coordinate system as `layout.points`).
 * @param newY           New Y coordinate (same coordinate system as `layout.points`).
 * @returns              A new LayoutModel reflecting the dragged position.
 */
export function applyDrag(
  model: GeometryModel,
  layout: LayoutModel,
  draggedPointId: string,
  newX: number,
  newY: number
): LayoutModel {
  // 1. Copy current positions into a mutable map.
  const points = new Map<string, Point>(
    layout.points.map((p) => [p.id, { ...p }])
  );

  // 2. Move the dragged point.
  points.set(draggedPointId, { id: draggedPointId, x: newX, y: newY });

  // 3. Re-derive circles and re-apply all constraints.
  //    Start from the current circle entries (copy so we don't mutate the base layout).
  const circles: Circle[] = layout.circles.map((c) => ({ ...c }));
  const diagnostics: string[] = [];
  reSolveConstraints(model, points, circles, diagnostics);

  // 4. Persist converged on-circle angles into the model.
  updateAngleParametersFromSolvedPositions(model, points, circles);

  // 5. Rebuild scene graph from the new positions.
  const nodes = buildSceneGraph(model, points, circles, diagnostics);

  const pointSet = new Set(points.keys());
  const segments = layout.segments.filter((s) => pointSet.has(s.a) && pointSet.has(s.b));
  const circleNodes = nodes.filter((n): n is CircleNode => n.kind === "circle");

  return {
    points: [...points.values()],
    segments,
    circles: circleNodes.map((n) => ({
      center: n.center,
      radius: n.radius,
      ...(n.id !== undefined && { id: n.id }),
    })),
    nodes,
    angleMarks: layout.angleMarks,
    rightAngleMarks: layout.rightAngleMarks,
    segmentMarks: layout.segmentMarks,
    diagnostics: [...layout.diagnostics, ...diagnostics],
  };
}
