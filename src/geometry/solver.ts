import { Circle, GeometryModel, LayoutModel, SceneNode, Point } from "../model/types.js";
import { applyDerivedCircles, applySolvingConstraints, updateAngleParametersFromSolvedPositions } from "./constraint-solver.js";

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

  const circleMap = new Map<string, Circle>();
  for (const c of base.circles) {
    circleMap.set(c.center, { ...c });
  }

  for (let i = 0; i < iterations; i += 1) {
    // Single snapshot: both applyDerivedCircles and applySolvingConstraints mutate
    // it in-place.  One circleMap sync at the end is sufficient.
    // iterDiag is throw-away — buildLayout already emitted all setup diagnostics.
    const iterDiag: string[] = [];
    const circlesArr = [...circleMap.values()];

    // Re-derive analytically-determined circle centers/radii (incircle, circumcircle,
    // diameter, circleConstraints) so they track their defining vertices.
    applyDerivedCircles(model, map, circlesArr, iterDiag);

    // Apply all positional / angular / relational constraints.
    applySolvingConstraints(model, map, circlesArr, iterDiag);

    // Sync the single mutated array back to the map.
    for (const c of circlesArr) circleMap.set(c.center, c);
  }

  const refinedPoints = [...map.values()];
  const pointSet = new Set(refinedPoints.map((p) => p.id));

  const refinedCircles = [...circleMap.values()].filter((c) => pointSet.has(c.center));
  const segments = base.segments.filter((s) => pointSet.has(s.a) && pointSet.has(s.b));

  // Propagate constraint labels from base.nodes through the refinement:
  // - LineNodes already in base retain their `constraint` and `dashed` labels;
  //   only filter out edges whose endpoints were dropped.
  // - CircleNodes get updated `radius` from the refined circle map (center may
  //   have moved), but keep their `constraint` label.
  const refinedCircleByCenter = new Map(refinedCircles.map((c) => [c.center, c]));
  const nodes: SceneNode[] = base.nodes
    .filter((n): boolean => {
      if (n.kind === "line")   return pointSet.has(n.a) && pointSet.has(n.b);
      if (n.kind === "circle") return refinedCircleByCenter.has(n.center);
      return false;
    })
    .map((n): SceneNode => {
      if (n.kind === "circle") {
        const refined = refinedCircleByCenter.get(n.center)!;
        return { ...n, radius: refined.radius };
      }
      return n;
    });

  // Persist the converged on-circle angles back into the model so a subsequent
  // re-solve (e.g. after a drag) starts from the stable converged positions.
  updateAngleParametersFromSolvedPositions(model, map, refinedCircles);

  diagnostics.push(`V2 solver applied with ${iterations} iterations.`);

  return {
    points: refinedPoints,
    segments,
    circles: refinedCircles,
    nodes,
    angleMarks: base.angleMarks,
    rightAngleMarks: base.rightAngleMarks,
    segmentMarks: base.segmentMarks,
    diagnostics
  };
}
