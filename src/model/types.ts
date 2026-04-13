export interface Point {
  id: string;
  label?: string;  // Point name (e.g., 'A', 'B', 'O')
  x: number;
  y: number;
}

export interface Segment {
  a: string;
  b: string;
  length?: number;
  dashed?: boolean;
}

export interface Circle {
  id?: string;
  center: string;
  radius: number;
  through?: string;  // point that defines the radius (e.g. A in "circle O through A")
}

export interface LineRef {
  a: string;
  b: string;
}

export interface Triangle {
  vertices: [string, string, string];
  rightAt?: string;
  isoscelesAt?: string;
  equilateral?: boolean;
}

export interface MidpointConstraint {
  point: string;
  a: string;
  b: string;
}

export interface PointOnSegmentConstraint {
  point: string;
  a: string;
  b: string;
}

export interface ParallelConstraint {
  line1: LineRef;
  line2: LineRef;
}

export interface PerpendicularConstraint {
  line1: LineRef;
  line2: LineRef;
}

export interface EqualLengthConstraint {
  segment1: LineRef;
  segment2: LineRef;
}

export interface EqualAngleConstraint {
  angle1: [string, string, string];
  angle2: [string, string, string];
}

export interface AltitudeConstraint {
  from: string;
  foot: string;
  baseA: string;
  baseB: string;
}

export interface MedianConstraint {
  from: string;
  foot: string;
  baseA: string;
  baseB: string;
}

export interface AngleBisectorConstraint {
  from: string;
  foot: string;
  sideA: string;
  sideB: string;
}

export interface TangentConstraint {
  circleId: string;
  pointId: string;
  // Legacy aliases used by older layout/enrichment code paths.
  at?: string;
  circleCenter?: string;
  pointOnCircle: boolean;  // true: tangent at a point on the circle, false: tangent through an external point
}

export interface IncircleConstraint {
  triangle?: [string, string, string];
  center?: string;
}

export interface CircumcircleConstraint {
  triangle?: [string, string, string];
}

export interface RectangleConstraint {
  vertices: [string, string, string, string];
}

export interface SquareConstraint {
  vertices: [string, string, string, string];
}

export interface ParallelogramConstraint {
  vertices: [string, string, string, string];
}

export interface TrapezoidConstraint {
  vertices: [string, string, string, string];
}

export interface CentroidConstraint {
  point: string;   // centroid point id (e.g. "G")
  a: string;       // triangle vertex A
  b: string;       // triangle vertex B
  c: string;       // triangle vertex C
}

export interface CircleByDiameterConstraint {
  a: string;
  b: string;
  circleId?: string;
  centerId?: string;
}

export interface PointOnCircleConstraint {
  point: string;
  circleId?: string;
  center: string;
}

export interface NamedTangentConstraint {
  at: string;
  circleId?: string;
  center?: string;
  linePoint: string;
}

export interface PerpendicularThroughPointIntersectionConstraint {
  through: string;
  toLine: LineRef;
  withLine: LineRef;
  intersection: string;
}

export interface Line {
  id: string;
  // Type 1: simple line through two points
  point1Id?: string;
  point2Id?: string;
  // Legacy aliases used by parser/LLM parser.
  a?: string;
  b?: string;
  // Type 2: perpendicular to another line, passing through a point
  perpendicularToId?: string;
  throughPointId?: string;
  // Legacy aliases used by parser/LLM parser.
  perpendicularTo?: LineRef;
  through?: string;
}

export interface LineIntersection {
  line1Id: string;
  line2Id: string;
  pointId: string;
}

export interface PerpendicularLine {
  id: string;
  pointId: string;   // point the line passes through
  lineId: string;    // line it is perpendicular to
}

export interface LineIntersectionConstraint {
  line1: string;  // line id
  line2: string;  // line id
  point: string;  // intersection point id
}

export interface PerpendicularLinesConstraint {
  line1: string;  // line id
  line2: string;  // line id
}

export interface TangentIntersectionConstraint {
  at: string;
  circleId?: string;
  center?: string;
  withLine: LineRef;
  intersection: string;
}

/**
 * Angle parameter for a FREE point on a circle.
 * Stores the angular position (radians) so the solver can deterministically
 * re-place the point on the circle across iterations, even when the center moves.
 *
 * id convention: "ang_E_on_cir_O"
 * point  — normalized point id, e.g. "point:E"
 * center — normalized CIRCLE CENTER id, e.g. "point:O" (matches circle.center)
 * value  — radians from positive-x axis; null means "pick heuristically and store"
 */
export interface AngleParameter {
  id: string;
  point: string;
  center: string;
  value: number | null;
}

export interface CircleConstraint {
  circleId: string;
  centerPointId: string;
  pointOnCircleId: string;
}

export interface DiameterConstraint {
  circleId: string;
  point1Id: string;
  point2Id: string;
}

export interface GeometryModel {
  rawText: string;
  points: string[];
  segments: Segment[];
  circles: Circle[];
  triangles: Triangle[];
  lines: Line[];  // NEW: explicit line objects
  midpoints: MidpointConstraint[];
  pointsOnSegments: PointOnSegmentConstraint[];
  parallels: ParallelConstraint[];
  perpendiculars: PerpendicularConstraint[];
  equalLengths: EqualLengthConstraint[];
  equalAngles: EqualAngleConstraint[];
  altitudes: AltitudeConstraint[];
  medians: MedianConstraint[];
  angleBisectors: AngleBisectorConstraint[];
  tangents: TangentConstraint[];
  incircles: IncircleConstraint[];
  circumcircles: CircumcircleConstraint[];
  rectangles: RectangleConstraint[];
  squares: SquareConstraint[];
  parallelograms: ParallelogramConstraint[];
  trapezoids: TrapezoidConstraint[];
  centroids: CentroidConstraint[];
  circlesByDiameter: CircleByDiameterConstraint[];
  pointsOnCircles: PointOnCircleConstraint[];
  circleConstraints: CircleConstraint[];  // NEW: circle defined by center point and point on circle
  diameterConstraints: DiameterConstraint[];  // NEW: diameter defined by two endpoints
  namedTangents: NamedTangentConstraint[];
  lineIntersections: LineIntersectionConstraint[];
  perpendicularLines: PerpendicularLinesConstraint[];
  perpendicularThroughPointIntersections: PerpendicularThroughPointIntersectionConstraint[];
  tangentIntersections: TangentIntersectionConstraint[];
  /** Angle parameters for free points on circles. Populated by canonicalToGeometryModel; optional for backward compat. */
  angleParameters?: AngleParameter[];
  /**
   * Display-only equal-angle hints populated by compiler synthesis (e.g. incircle).
   * These are removed from `equalAngles` to protect the solver but kept here for
   * SVG arc marker rendering. The solver does NOT read this field.
   */
  displayEqualAngles?: EqualAngleConstraint[];
}

// ─── Scene Graph Node types ───────────────────────────────────────────────────

/**
 * A `LineNode` represents a single drawable edge between two named points.
 *
 * `constraint` records which geometric relationship produced this edge
 * (e.g. "triangle-side", "altitude", "median", "tangent", "diameter-radius").
 * The SVG renderer uses it for styling (dash pattern, colour, hover tooltip).
 */
export interface LineNode {
  kind: "line";
  a: string;
  b: string;
  dashed?: boolean;
  constraint?: string;
}

/**
 * A `CircleNode` represents a drawable circle carried all the way to the renderer.
 * `constraint` records the relationship that defined it
 * (e.g. "circle", "incircle", "circumcircle", "circle-by-diameter").
 */
export interface CircleNode {
  kind: "circle";
  center: string;
  radius: number;
  id?: string;
  constraint?: string;
}

/** Discriminated union of all drawable scene-graph node variants. */
export type SceneNode = LineNode | CircleNode;

/**
 * A right-angle box mark rendered at a perpendicular junction.
 *
 * `pointId`  — the corner point (vertex of the right angle).
 * `line1Id`  — canonical edge key "A:B" (sorted) of the first line.
 * `line2Id`  — canonical edge key "A:B" (sorted) of the second line.
 * `size`     — optional override of the box side length in SVG pixels.
 *
 * Both line IDs can be resolved via `LayoutModel.nodes` (LineNode a/b fields)
 * or via `lineEntities` on the client (same canonical key).
 */
export interface RightAngleMark {
  pointId: string;
  line1Id: string;
  line2Id: string;
  size?: number;
}

/**
 * A visual angle-arc annotation tied to a single angle (3 ordered points).
 * Angles that belong to the same `group` are rendered with the same arc style,
 * indicating they are equal. Each `EqualAngleConstraint` pair produces two
 * AngleMark objects sharing the same group identifier.
 *
 * `points[1]` is the vertex; `points[0]` and `points[2]` are the arm endpoints.
 */
export interface AngleMark {
  /** Ordered triple [arm1_end, vertex, arm2_end] — vertex is the middle point. */
  points: [string, string, string];
  /** Equal-angle group id — marks with the same group share a visual style. */
  group?: string;
}

/**
 * A visual tick-mark annotation indicating two segments are equal in length.
 *
 * `a` / `b` are the two endpoint point-ids of the annotated segment.
 * Marks sharing the same `group` receive the same tick count (group ordinal
 * 0 → 1 tick, 1 → 2 ticks, etc.), visually expressing "all these segments
 * are equal to one another".
 */
export interface SegmentMark {
  /** Endpoint pair of the segment to annotate. */
  a: string;
  b: string;
  /** Equal-length group id. Marks with the same group share a tick style. */
  group?: string;
}

export interface LayoutModel {
  points: Point[];
  segments: Segment[];  // kept for backward compat; mirrors LineNodes
  circles: Circle[];    // kept for backward compat; mirrors CircleNodes
  nodes: SceneNode[];   // typed scene graph — authoritative source for rendering
  angleMarks?: AngleMark[];             // visual arc annotations (one per individual angle)
  rightAngleMarks?: RightAngleMark[];   // right-angle box marks at perpendicular junctions
  segmentMarks?: SegmentMark[];         // visual tick marks indicating equal-length segments
  diagnostics: string[];
}
