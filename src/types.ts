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
}

export interface Circle {
  id?: string;
  center: string;
  radius: number;
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
  pointOnCircle: boolean;  // true: tiếp tuyến tại điểm trên đường tròn, false: tiếp tuyến qua điểm ngoài đường tròn
}

export interface IncircleConstraint {
  triangle?: [string, string, string];
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
  // Type 2: perpendicular to another line, passing through a point
  perpendicularToId?: string;
  throughPointId?: string;
}

export interface LineIntersection {
  line1Id: string;
  line2Id: string;
  pointId: string;
}

export interface PerpendicularLine {
  id: string;
  pointId: string;   // điểm đường đi qua
  lineId: string;    // đường nó vuông góc với
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
  circlesByDiameter: CircleByDiameterConstraint[];
  pointsOnCircles: PointOnCircleConstraint[];
  circleConstraints: CircleConstraint[];  // NEW: circle defined by center point and point on circle
  diameterConstraints: DiameterConstraint[];  // NEW: diameter defined by two endpoints
  namedTangents: NamedTangentConstraint[];
  lineIntersections: LineIntersection[];  // NEW: two lines intersect at point
  perpendicularLines: PerpendicularLine[];  // NEW: perpendicular line through a point to a line
  perpendicularLinesConstraints: PerpendicularLinesConstraint[];  // two lines are perpendicular (legacy)
  perpendicularThroughPointIntersections: PerpendicularThroughPointIntersectionConstraint[];
  tangentIntersections: TangentIntersectionConstraint[];
}

export interface LayoutModel {
  points: Point[];
  segments: Segment[];
  circles: Circle[];
  diagnostics: string[];
}
