/**
 * runtime/schema.ts — Runtime Constraint Graph schema.
 *
 * Output of the canonical → runtime compiler.  This is what the solver and
 * interaction engine operate on.
 *
 * Key design decisions:
 *   • RuntimeNode construction types mirror CanonicalEntity constructions
 *     exactly — no lossy translation.
 *   • segment / triangle / angle are "structural" entities: they have no
 *     independent computed state beyond their endpoint references, so they
 *     appear as StructuralNode rather than dedicated compute nodes.
 *   • DependencyEdge is directed: `from` must be recomputed before `to`.
 *   • This schema contains NO geometry math — that lives in solver/.
 */

export type NodeId = string;

// ── Root ──────────────────────────────────────────────────────────────────────

export interface RuntimeGraph {
  /** All nodes in dependency order (topologically sorted by the compiler). */
  nodes: RuntimeNode[];
  /** Directed edges: from → to means `to` depends on `from`. */
  edges: DependencyEdge[];
  /** Fast lookup: nodeId → node */
  byId: Map<NodeId, RuntimeNode>;
  /** Fast lookup: nodeId → ids of nodes that directly depend on it */
  downstream: Map<NodeId, NodeId[]>;
}

// ── Node union ────────────────────────────────────────────────────────────────

export type RuntimeNode =
  | RuntimePointNode
  | RuntimeLineNode
  | RuntimeRayNode
  | RuntimeCircleNode
  | RuntimeParameterNode
  | RuntimeStructuralNode
  | RuntimeVectorNode
  | RuntimePolygonNode;

// ── Point ─────────────────────────────────────────────────────────────────────

export type PointConstructionRT =
  | { type: "free_point" }
  | { type: "midpoint";               a: NodeId; b: NodeId }
  | { type: "line_intersection";      line1: NodeId; line2: NodeId }
  | { type: "foot_of_perpendicular";  fromPoint: NodeId; toLine: NodeId }
  | { type: "projection";             point: NodeId; toLine: NodeId }
  | { type: "angle_bisector_foot";    vertex: NodeId; angle: NodeId; toSegment: NodeId }
  | { type: "circumcenter";           triangle: NodeId }
  | { type: "incenter";               triangle: NodeId }
  | { type: "centroid";               triangle: NodeId }
  | { type: "orthocenter";            triangle: NodeId }
  | { type: "point_on_circle";        circle: NodeId; angle?: NodeId }
  | { type: "point_on_line";          line: NodeId; parameter?: NodeId; t?: number }
  | { type: "antipode";               circle: NodeId; point: NodeId }
  | { type: "reflect";                point: NodeId; line: NodeId }
  | { type: "translate";              point: NodeId; vector: NodeId }
  | { type: "rotate";                 point: NodeId; center: NodeId; angle: NodeId };

export interface RuntimePointNode {
  id: NodeId;
  kind: "point";
  construction: PointConstructionRT;
  label?: string;
  origin?: string;
}

// ── Line ──────────────────────────────────────────────────────────────────────

export type LineConstructionRT =
  | { type: "free_line";                    px?: number; py?: number; dx?: number; dy?: number }
  | { type: "line_through_points";          a: NodeId; b: NodeId }
  | { type: "parallel_through_point";       point: NodeId; toLine: NodeId }
  | { type: "perpendicular_through_point";  point: NodeId; toLine: NodeId }
  | { type: "tangent_at_point";             circle: NodeId; point: NodeId }
  | { type: "perpendicular_bisector";       segment: NodeId }
  | { type: "angle_bisector_line";          angle: NodeId };

export interface RuntimeLineNode {
  id: NodeId;
  kind: "line";
  construction: LineConstructionRT;
  label?: string;
}

// ── Ray ───────────────────────────────────────────────────────────────────────

export type RayConstructionRT =
  | { type: "ray_from_point_through_point"; origin: NodeId; through: NodeId }
  | { type: "angle_bisector_ray";           angle: NodeId };

export interface RuntimeRayNode {
  id: NodeId;
  kind: "ray";
  construction: RayConstructionRT;
  label?: string;
}

// ── Circle ────────────────────────────────────────────────────────────────────

export type CircleConstructionRT =
  | { type: "circle_center_radius";         center: NodeId; radius: NodeId }
  | { type: "circle_center_through_point";  center: NodeId; through: NodeId }
  | { type: "circumcircle";                 triangle: NodeId }
  | { type: "incircle";                     triangle: NodeId };

export interface RuntimeCircleNode {
  id: NodeId;
  kind: "circle";
  construction: CircleConstructionRT;
  label?: string;
}

// ── Vector ───────────────────────────────────────────────────────────────────

export type VectorConstructionRT =
  | { type: "vector_from_points"; from: NodeId; to: NodeId }
  | { type: "direction_of_line";  line: NodeId };

export interface RuntimeVectorNode {
  id: NodeId;
  kind: "vector";
  construction: VectorConstructionRT;
  label?: string;
}

// ── Polygon ──────────────────────────────────────────────────────────────────

export interface RuntimePolygonNode {
  id: NodeId;
  kind: "polygon";
  refs: NodeId[];   // vertex point ids
  label?: string;
}

// ── Parameter ─────────────────────────────────────────────────────────────────

export interface RuntimeParameterNode {
  id: NodeId;
  kind: "radius_parameter" | "length_parameter" | "angle_parameter" | "line_parameter";
  value?: number;
  min?: number;
  max?: number;
  label?: string;
}

// ── Structural node ───────────────────────────────────────────────────────────
//
// segment / triangle / angle have no independent computed value — they are
// grouping constructs whose "value" is just the ordered list of their
// constituent node ids.  The solver skips them; the scene-graph compiler reads
// them for rendering.

export interface RuntimeStructuralNode {
  id: NodeId;
  kind: "segment" | "triangle" | "angle";
  /** Ordered constituent node ids (endpoints / vertices / angle-points). */
  refs: NodeId[];
  label?: string;
}

// ── Edge ──────────────────────────────────────────────────────────────────────

export interface DependencyEdge {
  /** The node that must be resolved first. */
  from: NodeId;
  /** The node that depends on `from`. */
  to: NodeId;
}
