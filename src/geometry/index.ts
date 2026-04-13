/**
 * Geometry Engine Module - Drawing and Constraint Solving
 *
 * Three-stage pipeline:
 * 1. Layout: Compute initial positions from constraints
 * 2. Solver: Iteratively refine positions to satisfy all constraints
 * 3. SVG: Render to SVG with proper coordinate system transformation
 */

export { buildLayout, DEFAULT_LAYOUT_POLICY } from '../layout/layout.js';
export type { LayoutPolicy } from '../layout/layout.js';
export { refineLayoutWithSolver } from './solver.js';
export { renderSvg, renderSvgFromCanvasCoords } from '../render/svg.js';
export type { CanvasPoint, CanvasSegment, CanvasCircle } from '../render/svg.js';
export { fitToViewport, computeBoundingBox, CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_PADDING } from '../render/viewport.js';
export type { FitInfo, BoundingBox, ViewportTransform } from '../render/viewport.js';
export { updateAngleParametersFromSolvedPositions, applyDerivedCircles, diameterConstraintCenterId, reSolveConstraints } from './constraint-solver.js';
export { applyDrag } from './drag.js';

export type {
  Point,
  LayoutModel,
  GeometryModel,
  SceneNode,
  LineNode,
  CircleNode,
} from '../model/index.js';
