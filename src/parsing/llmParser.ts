import { z } from "zod";
import { enrichModelForV2 } from "../model/v2Model.js";
import { normalizeModelIds } from "../model/normalize.js";
import type {
  GeometryModel,
  LineRef,
  Segment,
  Triangle,
  Circle,
  MidpointConstraint,
  PointOnSegmentConstraint,
  ParallelConstraint,
  PerpendicularConstraint,
  EqualLengthConstraint,
  EqualAngleConstraint,
  AltitudeConstraint,
  MedianConstraint,
  AngleBisectorConstraint,
  TangentConstraint,
  IncircleConstraint,
  CircumcircleConstraint,
  RectangleConstraint,
  SquareConstraint,
  ParallelogramConstraint,
  TrapezoidConstraint,
  CircleByDiameterConstraint,
  PointOnCircleConstraint,
  NamedTangentConstraint,
  PerpendicularThroughPointIntersectionConstraint,
  TangentIntersectionConstraint,
  Line,
  LineIntersectionConstraint,
  PerpendicularLinesConstraint,
  CircleConstraint,
  DiameterConstraint
} from "../model/types.js";

type LlmParseOptions = {
  model?: string;
};

const pointSchema = z.string().regex(/^[A-Z]$/);
const circleIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

const lineRefSchema = z.object({
  a: pointSchema,
  b: pointSchema
});

const geometryExtractSchema = z.object({
  points: z.array(pointSchema).default([]),
  segments: z.array(z.object({ a: pointSchema, b: pointSchema, length: z.number().nullish() })).default([]),
  circles: z.array(z.object({ id: circleIdSchema.optional(), center: pointSchema, radius: z.number().positive() })).default([]),
  triangles: z.array(z.object({
    vertices: z.tuple([pointSchema, pointSchema, pointSchema]),
    rightAt: z.union([pointSchema, z.string().transform(() => undefined), z.null().transform(() => undefined)]).optional(),
    isoscelesAt: z.union([pointSchema, z.string().transform(() => undefined), z.null().transform(() => undefined)]).optional(),
    equilateral: z.boolean().optional()
  })).default([]),
  midpoints: z.array(z.object({ point: pointSchema, a: pointSchema, b: pointSchema })).default([]),
  pointsOnSegments: z.array(z.object({ point: pointSchema, a: pointSchema, b: pointSchema })).default([]),
  parallels: z.array(z.object({ line1: lineRefSchema, line2: lineRefSchema })).default([]),
  perpendiculars: z.array(z.object({ line1: lineRefSchema, line2: lineRefSchema })).default([]),
  altitudes: z.array(z.object({ from: pointSchema, foot: pointSchema, baseA: pointSchema, baseB: pointSchema })).default([]),
  medians: z.array(z.object({ from: pointSchema, foot: pointSchema, baseA: pointSchema, baseB: pointSchema })).default([]),
  angleBisectors: z.array(z.object({ from: pointSchema, foot: pointSchema, sideA: pointSchema, sideB: pointSchema })).default([]),
  tangents: z.array(z.object({ circleId: z.string(), pointId: pointSchema, pointOnCircle: z.boolean() })).default([]),
  incircles: z.array(z.object({ triangle: z.tuple([pointSchema, pointSchema, pointSchema]).optional() })).default([]),
  circumcircles: z.array(z.object({ triangle: z.tuple([pointSchema, pointSchema, pointSchema]).optional() })).default([]),
  rectangles: z.array(z.object({ vertices: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]) })).default([]),
  squares: z.array(z.object({ vertices: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]) })).default([]),
  parallelograms: z.array(z.object({ vertices: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]) })).default([]),
  trapezoids: z.array(z.object({ vertices: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]) })).default([]),
  circlesByDiameter: z.array(z.object({ a: pointSchema, b: pointSchema, circleId: circleIdSchema.optional(), centerId: pointSchema.optional() })).default([]),
  pointsOnCircles: z.array(z.object({ point: pointSchema, circleId: circleIdSchema.optional(), center: pointSchema.optional() })).default([]),
  circleConstraints: z.array(z.object({ circleId: z.string(), centerPointId: pointSchema, pointOnCircleId: pointSchema })).default([]),
  diameterConstraints: z.array(z.object({ circleId: z.string(), point1Id: pointSchema, point2Id: pointSchema })).default([]),
  namedTangents: z.array(z.object({ at: pointSchema, circleId: circleIdSchema.optional(), center: pointSchema.optional(), linePoint: pointSchema })).default([]),
  lines: z.array(z.object({
    id: z.string(),
    a: pointSchema.optional(),
    b: pointSchema.optional(),
    perpendicularTo: lineRefSchema.optional(),
    through: pointSchema.optional()
  })).default([]),
  lineIntersections: z.array(z.object({
    line1: z.string(),
    line2: z.string(),
    point: pointSchema
  })).default([]),
  perpendicularLines: z.array(z.object({
    line1: z.string(),
    line2: z.string()
  })).default([]),
  perpendicularThroughPointIntersections: z.array(z.object({
    through: pointSchema,
    toLine: lineRefSchema,
    withLine: lineRefSchema,
    intersection: pointSchema
  })).default([]),
  tangentIntersections: z.array(z.object({
    at: pointSchema,
    circleId: circleIdSchema.optional(),
    center: pointSchema.optional(),
    withLine: lineRefSchema,
    intersection: pointSchema
  })).default([])
});

// ============ NEW PROPOSED SCHEMA ============
// More hierarchical and clearer structure for geometry problems

const geometryObjectSchema = z.union([
  z.object({ type: z.literal("circle"), name: z.string(), center: pointSchema.optional() }).passthrough(),
  z.object({ type: z.literal("diameter"), circle: z.string(), points: z.tuple([pointSchema, pointSchema]) }).passthrough(),
  z.object({ type: z.literal("point"), name: pointSchema, properties: z.array(z.string()).optional() }).passthrough(),
  z.object({ type: z.literal("point_on_circle"), point: pointSchema, circle: z.string() }).passthrough(),
  z.object({ type: z.literal("point_on_segment"), point: pointSchema, segment: z.string() }).passthrough(),
  z.object({ type: z.literal("segment"), name: z.string(), endpoints: z.tuple([pointSchema, pointSchema]), length: z.number().optional() }).passthrough(),
  z.object({ type: z.literal("line"), name: z.string(), through: z.array(pointSchema).optional() }).passthrough(),
  z.object({ type: z.literal("perpendicular_line"), name: z.string().optional(), point: pointSchema.optional(), to: z.string().optional() }).passthrough(),
  z.object({ type: z.literal("intersection"), of: z.array(z.string()), point: pointSchema.optional() }).passthrough(),
  z.object({ type: z.literal("triangle"), vertices: z.tuple([pointSchema, pointSchema, pointSchema]), properties: z.array(z.string()).optional() }).passthrough(),
  z.object({ type: z.literal("angle"), vertex: pointSchema, rays: z.tuple([pointSchema, pointSchema]), measure: z.string().optional() }).passthrough()
]);

const geometryConstructSchema = z.union([
  z.object({ type: z.literal("tangent"), point: pointSchema, circle: z.string(), name: z.string().optional() }).passthrough(),
  z.object({ type: z.literal("tangent_at_point"), point: pointSchema, circle: z.string() }).passthrough(),
  z.object({ type: z.literal("perpendicular_through"), point: pointSchema, to: z.string(), name: z.string().optional() }).passthrough(),
  z.object({ type: z.literal("perpendicular_at"), pointA: pointSchema, pointB: pointSchema, pointC: pointSchema, name: z.string().optional() }).passthrough(),
  z.object({ type: z.literal("parallel_through"), point: pointSchema, to: z.string(), name: z.string().optional() }).passthrough(),
  z.object({ type: z.literal("intersection"), of: z.array(z.string()), point: pointSchema.optional(), name: z.string().optional() }).passthrough(),
  z.object({ type: z.literal("midpoint"), of: z.string(), point: pointSchema.optional() }).passthrough(),
  z.object({ type: z.literal("altitude"), from: pointSchema, to: z.string(), foot: pointSchema.optional() }).passthrough(),
  z.object({ type: z.literal("median"), from: pointSchema, to: z.string(), midpoint: pointSchema.optional() }).passthrough()
]);

const geometryPropertySchema = z.object({
  subject: z.string(),
  predicate: z.string(),
  object: z.string().optional(),
  description: z.string().optional()
}).passthrough();

const proposedGeometrySchema = z.object({
  metadata: z.object({
    problem_number: z.string().optional(),
    title: z.string().optional(),
    parts: z.array(z.string()).optional()
  }).optional(),
  objects: z.array(geometryObjectSchema).default([]),
  construct: z.array(geometryConstructSchema).default([]),
  constraints: z.array(geometryPropertySchema).default([]),
  prove: z.array(z.string()).default([])
}).passthrough();

function uniqBy<T>(items: T[], keyOf: (it: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(keyOf(item), item);
  }
  return [...map.values()];
}

function normalizeJsonOutput(obj: any): any {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  // Normalize segments: wrap object in array
  if (obj.segments && !Array.isArray(obj.segments)) {
    if (typeof obj.segments === "object") {
      obj.segments = [obj.segments];
    } else {
      obj.segments = [];
    }
  }

  // Normalize circles: wrap object in array
  if (obj.circles && !Array.isArray(obj.circles)) {
    if (typeof obj.circles === "object" && obj.circles.center) {
      obj.circles = [obj.circles];
    } else {
      obj.circles = [];
    }
  }

  // Normalize diameterConstraints: wrap object in array
  if (obj.diameterConstraints && !Array.isArray(obj.diameterConstraints)) {
    if (typeof obj.diameterConstraints === "object") {
      obj.diameterConstraints = [obj.diameterConstraints];
    } else {
      obj.diameterConstraints = [];
    }
  }

  // Normalize perpendiculars: ensure line1/line2 are objects with a/b
  if (Array.isArray(obj.perpendiculars)) {
    obj.perpendiculars = obj.perpendiculars.map((p: any) => {
      if (p.line1 && typeof p.line1 === "string") {
        // line1 is a string like "OE", need to convert to {a, b}
        // For now, keep as is and let Zod handle it
      }
      if (p.line2 && typeof p.line2 === "string") {
        // line2 is a string like "CE", need to convert to {a, b}
      }
      return p;
    });
  }

  // Fix tangents: if a point is listed in pointsOnCircles or circles, mark it as pointOnCircle=true
  if (Array.isArray(obj.tangents)) {
    const circlePointSet = new Set<string>();
    
    // Collect all points marked as on circles
    if (Array.isArray(obj.pointsOnCircles)) {
      obj.pointsOnCircles.forEach((p: any) => {
        if (typeof p.point === "string") {
          circlePointSet.add(p.point);
        }
      });
    }

    // For diameter endpoints, they are on the circle
    if (Array.isArray(obj.diameterConstraints)) {
      obj.diameterConstraints.forEach((d: any) => {
        if (typeof d.point1Id === "string") circlePointSet.add(d.point1Id);
        if (typeof d.point2Id === "string") circlePointSet.add(d.point2Id);
      });
    }

    // Points on the circle from circles radius definition
    if (Array.isArray(obj.circles)) {
      obj.circles.forEach((c: any) => {
        // We don't know which points are on the circle from circle definition alone
      });
    }

    // Fix tangent pointOnCircle flag
    obj.tangents = obj.tangents.map((tan: any) => {
      // If point is one of C or D (diameter endpoints), it's on the circle
      if (typeof tan.pointId === "string" && circlePointSet.has(tan.pointId)) {
        tan.pointOnCircle = true;
      }
      return tan;
    });
  }

  return obj;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new Error("LLM response does not contain valid JSON object");
}

function parseChatCompletionContent(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n");
    if (text.trim()) {
      return text;
    }
  }

  throw new Error("Unexpected chat completion response format");
}

function buildModelFromExtract(rawText: string, extract: z.infer<typeof geometryExtractSchema>): GeometryModel {
  const segments: Segment[] = extract.segments.map(s => ({ ...s, length: s.length ?? undefined }));
  const circles: Circle[] = extract.circles.map((c, idx) => ({
    id: c.id ?? `C${idx + 1}`,
    center: c.center,
    radius: c.radius
  }));
  const triangles: Triangle[] = extract.triangles;
  const midpoints: MidpointConstraint[] = extract.midpoints;
  const pointsOnSegments: PointOnSegmentConstraint[] = extract.pointsOnSegments;
  const parallels: ParallelConstraint[] = extract.parallels;
  const perpendiculars: PerpendicularConstraint[] = extract.perpendiculars;
  const equalLengths: EqualLengthConstraint[] = [];
  const equalAngles: EqualAngleConstraint[] = [];
  const altitudes: AltitudeConstraint[] = extract.altitudes;
  const medians: MedianConstraint[] = extract.medians;
  const angleBisectors: AngleBisectorConstraint[] = extract.angleBisectors;
  const tangents: TangentConstraint[] = extract.tangents;
  const incircles: IncircleConstraint[] = extract.incircles;
  const circumcircles: CircumcircleConstraint[] = extract.circumcircles;
  const rectangles: RectangleConstraint[] = extract.rectangles;
  const squares: SquareConstraint[] = extract.squares;
  const parallelograms: ParallelogramConstraint[] = extract.parallelograms;
  const trapezoids: TrapezoidConstraint[] = extract.trapezoids;
  const circlesByDiameter: CircleByDiameterConstraint[] = extract.circlesByDiameter;
  const pointsOnCircles: PointOnCircleConstraint[] = extract.pointsOnCircles.map((it) => ({
    point: it.point,
    circleId: it.circleId,
    center: it.center ?? circles.find((c) => c.id === it.circleId)?.center ?? "O"
  }));
  const circleConstraints: CircleConstraint[] = extract.circleConstraints;
  const diameterConstraints: DiameterConstraint[] = extract.diameterConstraints;
  const namedTangents: NamedTangentConstraint[] = extract.namedTangents;
  const lines: Line[] = extract.lines;
  const lineIntersections: LineIntersectionConstraint[] = extract.lineIntersections;
  const perpendicularLines: PerpendicularLinesConstraint[] = extract.perpendicularLines;
  const perpendicularThroughPointIntersections: PerpendicularThroughPointIntersectionConstraint[] = extract.perpendicularThroughPointIntersections;
  const tangentIntersections: TangentIntersectionConstraint[] = extract.tangentIntersections;

  const circleRefSet = new Set<string>();
  for (const c of circles) {
    if (c.id) {
      circleRefSet.add(c.id);
    }
  }
  for (const dc of circlesByDiameter) {
    if (dc.circleId) {
      circleRefSet.add(dc.circleId);
    }
  }

  const circleCount = circleRefSet.size || circles.length || circlesByDiameter.length;
  const missingTangentCircleRef = [
    ...namedTangents.filter((t) => !t.circleId && !t.center),
    ...tangentIntersections.filter((t) => !t.circleId && !t.center)
  ];

  if (circleCount > 1 && missingTangentCircleRef.length > 0) {
    throw new Error(
      "Ambiguous tangent constraints: multiple circles detected, but some tangents do not specify circleId or center."
    );
  }

  const badCircleRefs = [
    ...tangents.map((t) => t.circleId).filter(Boolean),
    ...namedTangents.map((t) => t.circleId).filter(Boolean),
    ...pointsOnCircles.map((t) => t.circleId).filter(Boolean),
    ...tangentIntersections.map((t) => t.circleId).filter(Boolean)
  ].filter((id) => !circleRefSet.has(id as string));

  if (badCircleRefs.length > 0) {
    throw new Error(`Unknown circleId reference(s): ${[...new Set(badCircleRefs)].join(", ")}`);
  }

  const points = uniqBy(
    [
      ...extract.points,
      ...segments.flatMap((s) => [s.a, s.b]),
      ...circles.flatMap((c) => [c.center]),
      ...triangles.flatMap((t) => t.vertices),
      ...midpoints.flatMap((m) => [m.point, m.a, m.b]),
      ...pointsOnSegments.flatMap((p) => [p.point, p.a, p.b]),
      ...parallels.flatMap((p) => [p.line1.a, p.line1.b, p.line2.a, p.line2.b]),
      ...perpendiculars.flatMap((p) => [p.line1.a, p.line1.b, p.line2.a, p.line2.b]),
      ...altitudes.flatMap((a) => [a.from, a.foot, a.baseA, a.baseB]),
      ...medians.flatMap((m) => [m.from, m.foot, m.baseA, m.baseB]),
      ...angleBisectors.flatMap((a) => [a.from, a.foot, a.sideA, a.sideB]),
      ...tangents.flatMap((t) => [t.pointId]),
      ...incircles.flatMap((i) => i.triangle ?? []),
      ...circumcircles.flatMap((c) => c.triangle ?? []),
      ...rectangles.flatMap((r) => r.vertices),
      ...squares.flatMap((s) => s.vertices),
      ...parallelograms.flatMap((p) => p.vertices),
      ...trapezoids.flatMap((t) => t.vertices),
      ...circlesByDiameter.flatMap((c) => [c.a, c.b, ...(c.centerId ? [c.centerId] : [])]),
      ...pointsOnCircles.flatMap((p) => [p.point, p.center]),
      ...circleConstraints.flatMap((c) => [c.centerPointId, c.pointOnCircleId]),
      ...diameterConstraints.flatMap((d) => [d.point1Id, d.point2Id]),
      ...namedTangents.flatMap((n) => [n.at, n.linePoint, ...(n.center ? [n.center] : [])]),
      ...lines.flatMap((l) => [...(l.a ? [l.a] : []), ...(l.b ? [l.b] : []), ...(l.through ? [l.through] : []), ...(l.perpendicularTo ? [l.perpendicularTo.a, l.perpendicularTo.b] : [])]),
      ...lineIntersections.flatMap((li) => [li.point]),
      ...perpendicularThroughPointIntersections.flatMap((p) => [p.through, p.toLine.a, p.toLine.b, p.withLine.a, p.withLine.b, p.intersection]),
      ...tangentIntersections.flatMap((t) => [t.at, t.withLine.a, t.withLine.b, t.intersection, ...(t.center ? [t.center] : [])])
    ],
    (id) => id
  );

  return {
    rawText,
    points,
    segments: uniqBy(segments, (s) => `${[s.a, s.b].sort().join("")}:${s.length ?? ""}`),
    circles,
    triangles: uniqBy(triangles, (t) => `${t.vertices.join("")}:${t.rightAt ?? ""}:${t.isoscelesAt ?? ""}:${t.equilateral ? "1" : "0"}`),
    midpoints: uniqBy(midpoints, (m) => `${m.point}:${[m.a, m.b].sort().join("")}`),
    pointsOnSegments: uniqBy(pointsOnSegments, (p) => `${p.point}:${[p.a, p.b].sort().join("")}`),
    parallels: uniqBy(parallels, (p) => `${[p.line1.a, p.line1.b].sort().join("")}:${[p.line2.a, p.line2.b].sort().join("")}`),
    perpendiculars: uniqBy(perpendiculars, (p) => `${[p.line1.a, p.line1.b].sort().join("")}:${[p.line2.a, p.line2.b].sort().join("")}`),
    equalLengths: uniqBy(equalLengths, (it) => `${[it.segment1.a, it.segment1.b].sort().join("")}:${[it.segment2.a, it.segment2.b].sort().join("")}`),
    equalAngles: uniqBy(equalAngles, (it) => `${it.angle1.join("")}:${it.angle2.join("")}`),
    altitudes: uniqBy(altitudes, (a) => `${a.from}:${a.foot}:${[a.baseA, a.baseB].sort().join("")}`),
    medians: uniqBy(medians, (m) => `${m.from}:${m.foot}:${[m.baseA, m.baseB].sort().join("")}`),
    angleBisectors: uniqBy(angleBisectors, (a) => `${a.from}:${a.foot}:${a.sideA}:${a.sideB}`),
    tangents: uniqBy(tangents, (t) => `${t.circleId}:${t.pointId}:${t.pointOnCircle ? "1" : "0"}`),
    incircles: uniqBy(incircles, (i) => `I:${i.triangle?.join("") ?? ""}`),
    circumcircles: uniqBy(circumcircles, (c) => `O:${c.triangle?.join("") ?? ""}`),
    rectangles: uniqBy(rectangles, (r) => r.vertices.join("")),
    squares: uniqBy(squares, (s) => s.vertices.join("")),
    parallelograms: uniqBy(parallelograms, (p) => p.vertices.join("")),
    trapezoids: uniqBy(trapezoids, (t) => t.vertices.join("")),
    centroids: [],
    circlesByDiameter: uniqBy(circlesByDiameter, (c) => `${[c.a, c.b].sort().join("")}:${c.circleId ?? ""}:${c.centerId ?? ""}`),
    pointsOnCircles: uniqBy(pointsOnCircles, (p) => `${p.point}:${p.circleId ?? ""}:${p.center}`),
    circleConstraints: uniqBy(circleConstraints, (c) => `${c.circleId}:${c.centerPointId}:${c.pointOnCircleId}`),
    diameterConstraints: uniqBy(diameterConstraints, (d) => `${d.circleId}:${[d.point1Id, d.point2Id].sort().join(":")}`),
    namedTangents: uniqBy(namedTangents, (n) => `${n.at}:${n.linePoint}:${n.center ?? ""}`),
    lines: uniqBy(lines, (l) => `${l.id}`),
    lineIntersections: uniqBy(lineIntersections, (li) => `${[li.line1, li.line2].sort().join(":")}:${li.point}`),
    perpendicularLines: uniqBy(perpendicularLines, (pl) => `${[pl.line1, pl.line2].sort().join(":")}`),
    perpendicularThroughPointIntersections: uniqBy(perpendicularThroughPointIntersections, (p) => `${p.through}:${p.toLine.a}${p.toLine.b}:${p.withLine.a}${p.withLine.b}:${p.intersection}`),
    tangentIntersections: uniqBy(tangentIntersections, (t) => `${t.at}:${t.withLine.a}${t.withLine.b}:${t.intersection}:${t.center ?? ""}`)
  };
}

function isLocalOpenAICompatibleBaseUrl(baseUrl: string): boolean {
  return /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(baseUrl);
}

function getApiConfig(options: LlmParseOptions): { apiKey: string; model: string; baseUrl: string } {
  const baseUrl = (process.env.GEOMCP_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = process.env.GEOMCP_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey && !isLocalOpenAICompatibleBaseUrl(baseUrl)) {
    throw new Error("Missing API key. Set GEOMCP_OPENAI_API_KEY or OPENAI_API_KEY to use hosted LLM parser.");
  }

  const model = normalizeModelName(options.model ?? process.env.GEOMCP_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini");
  return { apiKey, model, baseUrl };
}

function normalizeModelName(model: string): string {
  const name = (model || "").trim();
  if (!name) {
    return "gpt-4.1-mini";
  }

  // Gemini 1.5 Flash is retired on some endpoints. Promote to a widely available successor.
  if (name === "gemini-1.5-flash") {
    return "gemini-2.0-flash";
  }

  return name;
}

function nextFallbackModel(model: string): string | null {
  if (model === "gemini-2.0-flash") {
    return "gemini-2.5-flash";
  }
  return null;
}

function buildPrompt(problem: string): string {
  return [
    "Extract geometry entities from the following problem.",
    "Return ONLY one JSON object with the exact schema below. No markdown, no explanations.",
    "CRITICAL RULES:",
    "- Use UPPERCASE single letters A-Z for all point names",
    "- segments MUST be an array: [{\"a\": \"A\", \"b\": \"B\", \"length\": optional}, ...]",
    "- circles MUST be an array: [{\"id\": \"C1\", \"center\": \"O\", \"radius\": number}, ...]",
    "- tangents MUST be an array: [{\"circleId\": \"C1\", \"pointId\": \"A\", \"pointOnCircle\": boolean}, ...]",
    "  * pointOnCircle=true if the point is on the circle circumference",
    "  * pointOnCircle=false if the point is outside the circle (e.g., tangent line touches at one point only)",
    "- perpendiculars MUST be an array: [{\"line1\": {\"a\": \"A\", \"b\": \"B\"}, \"line2\": {\"a\": \"C\", \"b\": \"D\"}}, ...]",
    "- diameterConstraints MUST be an array: [{\"circleId\": \"C1\", \"point1Id\": \"A\", \"point2Id\": \"B\"}, ...]",
    "- All other constraints must also be arrays, not single objects",
    "",
    "SCHEMA (all must be arrays):",
    "{",
    "  \"points\": [\"A\", \"B\", ...],",
    "  \"segments\": [{\"a\": \"A\", \"b\": \"B\", \"length\": optional}],",
    "  \"circles\": [{\"id\": \"C1\", \"center\": \"O\", \"radius\": 5}],",
    "  \"triangles\": [{\"vertices\": [\"A\", \"B\", \"C\"], \"rightAt\": \"B\", \"isoscelesAt\": \"A\", \"equilateral\": false}],",
    "  \"midpoints\": [{\"point\": \"M\", \"a\": \"A\", \"b\": \"B\"}],",
    "  \"pointsOnSegments\": [{\"point\": \"P\", \"a\": \"A\", \"b\": \"B\"}],",
    "  \"parallels\": [{\"line1\": {\"a\": \"A\", \"b\": \"B\"}, \"line2\": {\"a\": \"C\", \"b\": \"D\"}}],",
    "  \"perpendiculars\": [{\"line1\": {\"a\": \"A\", \"b\": \"B\"}, \"line2\": {\"a\": \"C\", \"b\": \"D\"}}],",
    "  \"tangents\": [{\"circleId\": \"C1\", \"pointId\": \"T\", \"pointOnCircle\": true}],",
    "  \"diameterConstraints\": [{\"circleId\": \"C1\", \"point1Id\": \"A\", \"point2Id\": \"B\"}],",
    "  \"pointsOnCircles\": [{\"point\": \"E\", \"circleId\": \"C1\", \"center\": \"O\"}],",
    "  ... all other constraint types as empty arrays [] if not mentioned ...",
    "}",
    "",
    "Problem:",
    problem
  ].join("\n");
}

function buildPromptProposed(problem: string): string {
  return [
    "Extract and structure the geometry problem using a hierarchical approach.",
    "Return ONLY one valid JSON object. No markdown, no explanations.",
    "",
    "STRUCTURE:",
    "1. objects: List all geometric objects mentioned",
    "2. construct: List all construction steps",
    "3. constraints: List all relationships/constraints",
    "4. prove: List all statements/theorems to prove",
    "",
    "SCHEMA EXAMPLES:",
    "{",
    '  "metadata": {"problem_number": "2", "title": "Circle with tangent", "parts": ["a", "b", "c"]},',
    '  "objects": [',
    '    {"type": "circle", "name": "O"},',
    '    {"type": "diameter", "circle": "O", "points": ["C", "D"]},',
    '    {"type": "point_on_circle", "point": "E", "circle": "O"},',
    '    {"type": "line", "name": "Cx", "through": ["C"], "perpendicular_to": "OE"}',
    '  ],',
    '  "construct": [',
    '    {"type": "tangent_at_point", "point": "C", "circle": "O"},',
    '    {"type": "perpendicular_through", "point": "O", "to": "CE", "name": "d"},',
    '    {"type": "intersection", "of": ["d", "Cx"], "point": "A"}',
    '  ],',
    '  "constraints": [',
    '    {"subject": "AE", "predicate": "is_tangent", "object": "O"},',
    '    {"subject": "AC", "predicate": "equal_to", "object": "BD"}',
    '  ],',
    '  "prove": [',
    '    "AE is tangent to circle(O)",',
    '    "AC + BD = AB",',
    '    "Triangle AOB is right-angled at O"',
    '  ]',
    "}",
    "",
    "KEY POINTS:",
    "- Use UPPERCASE single letters A-Z for point names",
    "- ALL arrays (objects, construct, constraints, prove) must be provided",
    "- For 'objects': type can be circle, diameter, point, point_on_circle, segment, line, triangle, angle",
    "- For 'construct': type can be tangent, perpendicular_through, parallel_through, intersection, midpoint, altitude, median",
    "- For 'prove': string statements should be clear geometric relationships",
    "",
    "Problem:",
    problem
  ].join("\n");
}

export async function parseGeometryProblemWithLLM(
  problem: string,
  options: LlmParseOptions = {}
): Promise<GeometryModel> {
  const { apiKey, model, baseUrl } = getApiConfig(options);

  const messages = [
    {
      role: "system",
      content:
        "You are a strict geometry information extractor. Return only valid JSON. Do not include markdown code fences."
    },
    {
      role: "user",
      content: buildPrompt(problem)
    }
  ];

  const postCompletion = async (modelName: string) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        seed: 42,
        top_p: 1,
        top_k: 1,
        messages
      })
    });
  };

  let selectedModel = model;
  let response = await postCompletion(selectedModel);
  if (!response.ok && response.status === 404) {
    const fallback = nextFallbackModel(selectedModel);
    if (fallback) {
      selectedModel = fallback;
      response = await postCompletion(selectedModel);
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API error ${response.status} (model=${selectedModel}): ${errText}`);
  }

  const payload = await response.json();
  const contentText = parseChatCompletionContent(payload);
  const jsonObj = extractJsonObject(contentText);
  const normalizedObj = normalizeJsonOutput(jsonObj);
  const extract = geometryExtractSchema.parse(normalizedObj);

  return normalizeModelIds(enrichModelForV2(buildModelFromExtract(problem, extract)));
}

// New proposed schema parser - returns raw JSON for debugging
export async function parseGeometryProblemWithLLMProposed(
  problem: string,
  options: LlmParseOptions = {}
): Promise<z.infer<typeof proposedGeometrySchema>> {
  const { apiKey, model, baseUrl } = getApiConfig(options);

  const messages = [
    {
      role: "system",
      content:
        "You are a strict geometry information extractor. Return only valid JSON. Do not include markdown code fences. You must understand geometric objects, constructions, and proofs."
    },
    {
      role: "user",
      content: buildPromptProposed(problem)
    }
  ];

  const postCompletion = async (modelName: string) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        messages
      })
    });
  };

  let selectedModel = model;
  let response = await postCompletion(selectedModel);
  if (!response.ok && response.status === 404) {
    const fallback = nextFallbackModel(selectedModel);
    if (fallback) {
      selectedModel = fallback;
      response = await postCompletion(selectedModel);
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API error ${response.status} (model=${selectedModel}): ${errText}`);
  }

  const payload = await response.json();
  const contentText = parseChatCompletionContent(payload);
  const jsonObj = extractJsonObject(contentText);
  const extract = proposedGeometrySchema.parse(jsonObj);

  return extract;
}
