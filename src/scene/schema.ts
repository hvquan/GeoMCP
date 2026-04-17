/**
 * scene/schema.ts — SceneGraph v1.3 data model.
 *
 * This is the "render-ready" scene description.  It sits between the
 * geometry solver and the renderer:
 *
 *   geometry model  →  scene graph  →  SVG / Canvas / WebGL
 *
 * Design rules:
 *   • Contains only visual facts (positions, styles, marks).
 *   • No constraint-solver logic.
 *   • triangle / polygon are composite drawables, not semantic geometry.
 *   • altitude / median / bisector / etc. are primitive + roles.
 *   • interaction metadata describes UI affordance only — no solver.
 */

// ── Base ──────────────────────────────────────────────────────────────────────

export type OriginKind = "explicit" | "derived" | "implicit";

export type EditMode =
  | "move_point"
  | "change_radius"
  | "change_angle"
  | "none";

export type HitTarget =
  | "point"
  | "center"
  | "border"
  | "body"
  | "none";

export type InteractionKind =
  | "free_point"
  | "derived_point"
  | "parameter_handle"
  | "computed"
  | "fixed";

export interface InteractionMeta {
  selectable?: boolean;
  hoverable?: boolean;
  draggable?: boolean;
  editMode?: EditMode;
  hitTarget?: HitTarget;
  kind?: InteractionKind;
  reason?: string;
  /** For change_angle points: the circle ID this point is constrained to lie on. */
  constrainedToCircle?: string;
}

export interface BaseSceneObject {
  id: string;
  label?: string | null;
  origin?: OriginKind;
  roles?: string[];
  visible?: boolean;
  style?: string;
  debugName?: string;
  interaction?: InteractionMeta;
}

// ── Points ────────────────────────────────────────────────────────────────────

export interface ScenePoint extends BaseSceneObject {
  kind: "point";
  x: number;
  y: number;
}

// ── Geometry primitives ───────────────────────────────────────────────────────

export interface SceneSegment extends BaseSceneObject {
  kind: "segment";
  a: string;  // point id
  b: string;  // point id
}

export type SceneRay =
  | (BaseSceneObject & { kind: "ray"; originPoint: string; throughPoint: string })
  | (BaseSceneObject & { kind: "ray"; originPoint: string; direction: { x: number; y: number } });

export type SceneLine =
  | (BaseSceneObject & { kind: "line"; a: string; b: string })
  | (BaseSceneObject & { kind: "line"; throughPointId: string; direction: { x: number; y: number } });

export interface SceneCircle extends BaseSceneObject {
  kind: "circle";
  center: string;  // point id
  radius: number;  // world-space units
}

// ── Composite drawables ───────────────────────────────────────────────────────

export interface SceneTriangle extends BaseSceneObject {
  kind: "triangle";
  points: [string, string, string];  // point ids
  fill?: string;
  strokeStyle?: string;
}

export interface ScenePolygon extends BaseSceneObject {
  kind: "polygon";
  points: string[];  // point ids, length >= 3
  fill?: string;
  strokeStyle?: string;
}

// ── Geometry node union ───────────────────────────────────────────────────────

export type SceneGeometryNode =
  | SceneSegment
  | SceneRay
  | SceneLine
  | SceneCircle
  | SceneTriangle
  | ScenePolygon;

// ── Annotation marks ──────────────────────────────────────────────────────────

export type AngleMarkStyle = "single_arc" | "double_arc" | "triple_arc";

export interface SceneAngleMark extends BaseSceneObject {
  kind: "angle_mark";
  points: [string, string, string];  // [A, B, C] → ∠ABC, B is vertex
  group?: string;
  markStyle: AngleMarkStyle;
  radius?: number;  // world units; default applied if omitted
}

export interface SceneRightAngleMark extends BaseSceneObject {
  kind: "right_angle_mark";
  pointId: string;   // vertex point id
  line1Id: string;   // geometry node id
  line2Id: string;   // geometry node id
  size?: number;     // world units
}

export type SegmentMarkStyle = "single_tick" | "double_tick" | "triple_tick";

export interface SceneSegmentMark extends BaseSceneObject {
  kind: "segment_mark";
  a: string;  // point id
  b: string;  // point id
  group?: string;
  markStyle: SegmentMarkStyle;
  size?: number;  // world units
}

// ── Labels ────────────────────────────────────────────────────────────────────

export interface SceneLabel extends BaseSceneObject {
  kind: "label";
  targetId: string;
  text: string;
  dx?: number;
  dy?: number;
}

// ── Root scene graph ──────────────────────────────────────────────────────────

export interface SceneGraph {
  version: "scene-graph/v1" | "scene-graph/v1.1" | "scene-graph/v1.2" | "scene-graph/v1.3";
  coordinateSystem?: "math-y-up";
  points: ScenePoint[];
  geometry: SceneGeometryNode[];
  angleMarks: SceneAngleMark[];
  rightAngleMarks: SceneRightAngleMark[];
  segmentMarks: SceneSegmentMark[];
  labels?: SceneLabel[];
}

// ── Full object union (useful for generic processing) ─────────────────────────

export type SceneObject =
  | ScenePoint
  | SceneSegment
  | SceneRay
  | SceneLine
  | SceneCircle
  | SceneTriangle
  | ScenePolygon
  | SceneAngleMark
  | SceneRightAngleMark
  | SceneSegmentMark
  | SceneLabel;

// ── Pipeline intermediates ────────────────────────────────────────────────────
// Produced and consumed by the parse → layout → style → render stages.
// Kept here so a single import covers the full scene→SVG type surface.

export interface ValidationError {
  message: string;
  path?: string;
}

export interface ValidatedScene {
  scene: SceneGraph;
  errors: ValidationError[];
  warnings: string[];
}

export interface PositionedPoint {
  id: string;
  x: number;
  y: number;
  visible?: boolean;
  label: string;
  labelOffset: { dx: number; dy: number };
  interaction?: InteractionMeta;
}

export interface PositionedScene {
  points: PositionedPoint[];
  geometry: SceneGeometryNode[];
  angleMarks: SceneAngleMark[];
  rightAngleMarks: SceneRightAngleMark[];
  segmentMarks: SceneSegmentMark[];
  labels: SceneLabel[];
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface PointStyle {
  radius: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  labelFont: string;
  labelSize: number;
  labelColor: string;
}

export interface LineStyle {
  stroke: string;
  strokeWidth: number;
  dashArray?: string;
}

export interface StyledPoint extends PositionedPoint {
  resolvedStyle: PointStyle;
}

export interface StyledScene {
  points: StyledPoint[];
  geometry: SceneGeometryNode[];
  angleMarks: SceneAngleMark[];
  rightAngleMarks: SceneRightAngleMark[];
  segmentMarks: SceneSegmentMark[];
  labels: SceneLabel[];
  viewport: { width: number; height: number; viewBox: string };
  scale: number;
}

export interface PipelineStep {
  step: number;
  label: string;
  data: unknown;
}

export interface PipelineResult {
  steps: PipelineStep[];
  svg: string;
  errors: ValidationError[];
  warnings: string[];
}
