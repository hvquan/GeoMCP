export interface Point {
  id: string;
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
  at: string;
  circleId?: string;
  circleCenter?: string;
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

export interface TangentIntersectionConstraint {
  at: string;
  circleId?: string;
  center?: string;
  withLine: LineRef;
  intersection: string;
}

export interface GeometryModel {
  rawText: string;
  points: string[];
  segments: Segment[];
  circles: Circle[];
  triangles: Triangle[];
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
  namedTangents: NamedTangentConstraint[];
  perpendicularThroughPointIntersections: PerpendicularThroughPointIntersectionConstraint[];
  tangentIntersections: TangentIntersectionConstraint[];
}

export interface LayoutModel {
  points: Point[];
  segments: Segment[];
  circles: Circle[];
  diagnostics: string[];
}
