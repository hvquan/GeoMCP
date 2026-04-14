/**
 * canonical/schema.ts — Canonical Geometry IR v1
 *
 * Engine-side contract between parsing/adapters and the geometry solver.
 *
 *   Text → LLM → model-specific DSL
 *     → DSL adapter
 *     → CanonicalGeometryIR          ← this file
 *     → Runtime Constraint Graph compiler
 *     → Solver / Recompute engine
 *     → SceneGraph (render-ready)
 *     → SVG
 *
 * Design rules (strictly enforced):
 *   ✗ No pixel or canvas coordinates (x/y live in solved state, not here)
 *   ✗ No render concerns (roles, fill, stroke … live in SceneGraph)
 *   ✗ No interaction affordances (editMode, hitTarget … live in SceneGraph)
 *   ✓ Declarative: describes WHAT, not HOW to compute
 *   ✓ construction is the primary semantic carrier
 *   ✓ Parameters are first-class entities (radius, length, angle)
 *   ✓ Relations capture geometric facts independently of constructions
 */

// ── Aliases ───────────────────────────────────────────────────────────────────

/** Opaque string id referencing any entity in the same IR document. */
export type EntityId = string;

export type OriginKind = "explicit" | "derived" | "implicit";

// ── Root ──────────────────────────────────────────────────────────────────────

export interface CanonicalGeometryIR {
  version: "canonical-geometry/v1";
  entities: CanonicalEntity[];
  relations?: CanonicalRelation[];
}

// ── Entity union ──────────────────────────────────────────────────────────────

export type CanonicalEntity =
  | CanonicalPoint
  | CanonicalLine
  | CanonicalRay
  | CanonicalSegment
  | CanonicalCircle
  | CanonicalAngle
  | CanonicalTriangle
  | CanonicalPolygon
  | CanonicalVector
  | CanonicalParameter;

// ── Point ─────────────────────────────────────────────────────────────────────

export type PointConstruction =
  /** User-positioned; the solver treats this as a free variable. */
  | { type: "free_point" }
  /** Midpoint of segment [a, b]. */
  | { type: "midpoint"; a: EntityId; b: EntityId }
  /** Intersection of two lines / rays / segments. */
  | { type: "line_intersection"; line1: EntityId; line2: EntityId }
  /** Foot of perpendicular from `fromPoint` onto `toLine`. */
  | { type: "foot_of_perpendicular"; fromPoint: EntityId; toLine: EntityId }
  /** Orthogonal projection of `point` onto `toLine` (alias of foot_of_perpendicular). */
  | { type: "projection"; point: EntityId; toLine: EntityId }
  /**
   * Foot of the angle-bisector ray from `vertex` of angle `angle`
   * onto the opposite segment `toSegment`.
   */
  | { type: "angle_bisector_foot"; vertex: EntityId; angle: EntityId; toSegment: EntityId }
  /** Circumcenter of `triangle`. */
  | { type: "circumcenter"; triangle: EntityId }
  /** Incenter of `triangle`. */
  | { type: "incenter"; triangle: EntityId }
  /** Centroid of `triangle`. */
  | { type: "centroid"; triangle: EntityId }
  /** Orthocenter of `triangle`. */
  | { type: "orthocenter"; triangle: EntityId }
  /** Point on `circle`, position controlled by an angle parameter. */
  | { type: "point_on_circle"; circle: EntityId; angle?: EntityId }
  /** Point on `line`, position controlled by a length parameter or embedded t. */
  | { type: "point_on_line"; line: EntityId; parameter?: EntityId; t?: number }
  /** Diametrically opposite point of `point` on `circle`. */
  | { type: "antipode"; circle: EntityId; point: EntityId }
  /** Reflection of `point` across `line`. */
  | { type: "reflect"; point: EntityId; line: EntityId }
  /** Translation of `point` by `vector`. */
  | { type: "translate"; point: EntityId; vector: EntityId }
  /** Rotation of `point` around `center` by the angle in `angle` parameter. */
  | { type: "rotate"; point: EntityId; center: EntityId; angle: EntityId };

export interface CanonicalPoint {
  id: EntityId;
  kind: "point";
  label?: string;
  origin?: OriginKind;
  /** How this point is constructed. Absent ⟹ treated as free_point. */
  construction?: PointConstruction;
}

// ── Line ──────────────────────────────────────────────────────────────────────

export type LineConstruction =
  /** Free (explicitly declared) line — position/direction set externally. */
  | { type: "free_line"; px?: number; py?: number; dx?: number; dy?: number }
  /** Infinite line through two points. */
  | { type: "line_through_points"; a: EntityId; b: EntityId }
  /** Line through `point` parallel to `toLine`. */
  | { type: "parallel_through_point"; point: EntityId; toLine: EntityId }
  /** Line through `point` perpendicular to `toLine`. */
  | { type: "perpendicular_through_point"; point: EntityId; toLine: EntityId }
  /** Tangent to `circle` at `point` (point must lie on circle). */
  | { type: "tangent_at_point"; circle: EntityId; point: EntityId }
  /** Perpendicular bisector of `segment`. */
  | { type: "perpendicular_bisector"; segment: EntityId }
  /** Angle bisector of `angle` as a full infinite line. */
  | { type: "angle_bisector_line"; angle: EntityId };

export interface CanonicalLine {
  id: EntityId;
  kind: "line";
  label?: string;
  construction: LineConstruction;
}

// ── Ray ───────────────────────────────────────────────────────────────────────

export type RayConstruction =
  /** Ray from `origin` through `through`. */
  | { type: "ray_from_point_through_point"; origin: EntityId; through: EntityId }
  /** Angle-bisector ray of `angle` (origin = vertex of the angle). */
  | { type: "angle_bisector_ray"; angle: EntityId };

export interface CanonicalRay {
  id: EntityId;
  kind: "ray";
  label?: string;
  construction: RayConstruction;
}

// ── Segment ───────────────────────────────────────────────────────────────────

export interface CanonicalSegment {
  id: EntityId;
  kind: "segment";
  label?: string;
  construction: { type: "segment_between_points"; a: EntityId; b: EntityId };
}

// ── Circle ────────────────────────────────────────────────────────────────────

export type CircleConstruction =
  /**
   * Center + explicit radius parameter.
   * `radius` must reference a `radius_parameter` entity in the same IR.
   */
  | { type: "circle_center_radius"; center: EntityId; radius: EntityId }
  /** Circle centered at `center`, passing through `through`. */
  | { type: "circle_center_through_point"; center: EntityId; through: EntityId }
  /** Circumscribed (circumcircle) of `triangle`. */
  | { type: "circumcircle"; triangle: EntityId }
  /** Inscribed circle (incircle) of `triangle`. */
  | { type: "incircle"; triangle: EntityId };

export interface CanonicalCircle {
  id: EntityId;
  kind: "circle";
  label?: string;
  construction: CircleConstruction;
}

// ── Angle ─────────────────────────────────────────────────────────────────────

export interface CanonicalAngle {
  id: EntityId;
  kind: "angle";
  label?: string;
  construction: { type: "angle_from_points"; points: [EntityId, EntityId, EntityId] };
}

// ── Triangle ──────────────────────────────────────────────────────────────────

export interface CanonicalTriangle {
  id: EntityId;
  kind: "triangle";
  label?: string;
  construction: { type: "triangle_from_points"; vertices: [EntityId, EntityId, EntityId] };
}

// ── Parameters ────────────────────────────────────────────────────────────────
//
// Named scalars referenced by constructions (e.g. circle radius).
// The solver treats these as free variables that can be dragged/animated.

export type CanonicalParameter =
  | { id: EntityId; kind: "radius_parameter"; construction: { type: "free_radius"; value?: number }; min?: number; max?: number; label?: string }
  | { id: EntityId; kind: "length_parameter"; construction: { type: "free_length";  value?: number }; min?: number; max?: number; label?: string }
  | { id: EntityId; kind: "angle_parameter";  construction: { type: "free_angle";   value?: number }; min?: number; max?: number; label?: string }
  | { id: EntityId; kind: "line_parameter";   construction: { type: "free_line_parameter"; value?: number }; min?: number; max?: number; label?: string };

// ── Polygon ───────────────────────────────────────────────────────────────────

export interface CanonicalPolygon {
  id: EntityId;
  kind: "polygon";
  label?: string;
  construction: { type: "polygon_from_points"; vertices: EntityId[] };
}

// ── Vector ────────────────────────────────────────────────────────────────────

export type VectorConstruction =
  /** Vector defined by two points: to − from. */
  | { type: "vector_from_points"; from: EntityId; to: EntityId }
  /** Unit direction vector of a line. */
  | { type: "direction_of_line"; line: EntityId };

export interface CanonicalVector {
  id: EntityId;
  kind: "vector";
  label?: string;
  construction: VectorConstruction;
}

// ── Relations ─────────────────────────────────────────────────────────────────
//
// Asserted geometric facts that hold between entities.
// These are NOT construction recipes — they express constraints or theorems.

export type CanonicalRelation =
  /** Two lines / segments / rays are perpendicular. */
  | { type: "perpendicular"; line1: EntityId; line2: EntityId }
  /** Two lines / segments / rays are parallel. */
  | { type: "parallel"; line1: EntityId; line2: EntityId }
  /** Two segments have equal length. */
  | { type: "equal_length"; seg1: EntityId; seg2: EntityId }
  /** Two angles are equal. */
  | { type: "equal_angle"; ang1: EntityId; ang2: EntityId }
  /** A point lies on a circle. */
  | { type: "point_on_circle"; point: EntityId; circle: EntityId }
  /** A point lies on a line / segment / ray. */
  | { type: "point_on_line"; point: EntityId; line: EntityId }
  /** Three or more points are collinear. */
  | { type: "collinear"; points: EntityId[] }
  /** Four or more points lie on a common circle. */
  | { type: "concyclic"; points: EntityId[] }
  /** A line is tangent to a circle. */
  | { type: "tangent_line_circle"; line: EntityId; circle: EntityId }
  /** Two circles are tangent (externally or internally). */
  | { type: "tangent_circles"; circle1: EntityId; circle2: EntityId; kind?: "external" | "internal" };
