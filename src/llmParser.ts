import { z } from "zod";
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
  TangentIntersectionConstraint
} from "./types.js";

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
  segments: z.array(z.object({ a: pointSchema, b: pointSchema, length: z.number().optional() })).default([]),
  circles: z.array(z.object({ id: circleIdSchema.optional(), center: pointSchema, radius: z.number().positive() })).default([]),
  triangles: z.array(z.object({
    vertices: z.tuple([pointSchema, pointSchema, pointSchema]),
    rightAt: pointSchema.optional(),
    isoscelesAt: pointSchema.optional(),
    equilateral: z.boolean().optional()
  })).default([]),
  midpoints: z.array(z.object({ point: pointSchema, a: pointSchema, b: pointSchema })).default([]),
  pointsOnSegments: z.array(z.object({ point: pointSchema, a: pointSchema, b: pointSchema })).default([]),
  parallels: z.array(z.object({ line1: lineRefSchema, line2: lineRefSchema })).default([]),
  perpendiculars: z.array(z.object({ line1: lineRefSchema, line2: lineRefSchema })).default([]),
  altitudes: z.array(z.object({ from: pointSchema, foot: pointSchema, baseA: pointSchema, baseB: pointSchema })).default([]),
  medians: z.array(z.object({ from: pointSchema, foot: pointSchema, baseA: pointSchema, baseB: pointSchema })).default([]),
  angleBisectors: z.array(z.object({ from: pointSchema, foot: pointSchema, sideA: pointSchema, sideB: pointSchema })).default([]),
  tangents: z.array(z.object({ at: pointSchema, circleId: circleIdSchema.optional(), circleCenter: pointSchema.optional() })).default([]),
  incircles: z.array(z.object({ triangle: z.tuple([pointSchema, pointSchema, pointSchema]).optional() })).default([]),
  circumcircles: z.array(z.object({ triangle: z.tuple([pointSchema, pointSchema, pointSchema]).optional() })).default([]),
  rectangles: z.array(z.object({ vertices: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]) })).default([]),
  squares: z.array(z.object({ vertices: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]) })).default([]),
  parallelograms: z.array(z.object({ vertices: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]) })).default([]),
  trapezoids: z.array(z.object({ vertices: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]) })).default([]),
  circlesByDiameter: z.array(z.object({ a: pointSchema, b: pointSchema, circleId: circleIdSchema.optional(), centerId: pointSchema.optional() })).default([]),
  pointsOnCircles: z.array(z.object({ point: pointSchema, circleId: circleIdSchema.optional(), center: pointSchema.optional() })).default([]),
  namedTangents: z.array(z.object({ at: pointSchema, circleId: circleIdSchema.optional(), center: pointSchema.optional(), linePoint: pointSchema })).default([]),
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

function uniqBy<T>(items: T[], keyOf: (it: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(keyOf(item), item);
  }
  return [...map.values()];
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
  const segments: Segment[] = extract.segments;
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
  const namedTangents: NamedTangentConstraint[] = extract.namedTangents;
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
    ...tangents.filter((t) => !t.circleId && !t.circleCenter),
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
      ...tangents.flatMap((t) => [t.at, ...(t.circleCenter ? [t.circleCenter] : [])]),
      ...incircles.flatMap((i) => i.triangle ?? []),
      ...circumcircles.flatMap((c) => c.triangle ?? []),
      ...rectangles.flatMap((r) => r.vertices),
      ...squares.flatMap((s) => s.vertices),
      ...parallelograms.flatMap((p) => p.vertices),
      ...trapezoids.flatMap((t) => t.vertices),
      ...circlesByDiameter.flatMap((c) => [c.a, c.b, ...(c.centerId ? [c.centerId] : [])]),
      ...pointsOnCircles.flatMap((p) => [p.point, p.center]),
      ...namedTangents.flatMap((n) => [n.at, n.linePoint, ...(n.center ? [n.center] : [])]),
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
    altitudes: uniqBy(altitudes, (a) => `${a.from}:${a.foot}:${[a.baseA, a.baseB].sort().join("")}`),
    medians: uniqBy(medians, (m) => `${m.from}:${m.foot}:${[m.baseA, m.baseB].sort().join("")}`),
    angleBisectors: uniqBy(angleBisectors, (a) => `${a.from}:${a.foot}:${a.sideA}:${a.sideB}`),
    tangents: uniqBy(tangents, (t) => `${t.at}:${t.circleCenter ?? ""}`),
    incircles: uniqBy(incircles, (i) => `I:${i.triangle?.join("") ?? ""}`),
    circumcircles: uniqBy(circumcircles, (c) => `O:${c.triangle?.join("") ?? ""}`),
    rectangles: uniqBy(rectangles, (r) => r.vertices.join("")),
    squares: uniqBy(squares, (s) => s.vertices.join("")),
    parallelograms: uniqBy(parallelograms, (p) => p.vertices.join("")),
    trapezoids: uniqBy(trapezoids, (t) => t.vertices.join("")),
    circlesByDiameter: uniqBy(circlesByDiameter, (c) => `${[c.a, c.b].sort().join("")}:${c.circleId ?? ""}:${c.centerId ?? ""}`),
    pointsOnCircles: uniqBy(pointsOnCircles, (p) => `${p.point}:${p.circleId ?? ""}:${p.center}`),
    namedTangents: uniqBy(namedTangents, (n) => `${n.at}:${n.linePoint}:${n.center ?? ""}`),
    perpendicularThroughPointIntersections: uniqBy(perpendicularThroughPointIntersections, (p) => `${p.through}:${p.toLine.a}${p.toLine.b}:${p.withLine.a}${p.withLine.b}:${p.intersection}`),
    tangentIntersections: uniqBy(tangentIntersections, (t) => `${t.at}:${t.withLine.a}${t.withLine.b}:${t.intersection}:${t.center ?? ""}`)
  };
}

function getApiConfig(options: LlmParseOptions): { apiKey: string; model: string; baseUrl: string } {
  const apiKey = process.env.GEOMCP_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("Missing API key. Set GEOMCP_OPENAI_API_KEY or OPENAI_API_KEY to use LLM parser.");
  }

  const model = options.model ?? process.env.GEOMCP_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const baseUrl = (process.env.GEOMCP_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

  return { apiKey, model, baseUrl };
}

function buildPrompt(problem: string): string {
  return [
    "Extract geometry entities from the following problem.",
    "Return only one JSON object with keys exactly matching the schema.",
    "Use single uppercase letters for all point names.",
    "Each circle should include an id (e.g. C1, C2) when possible.",
    "For tangent constraints, always provide circleId (or circleCenter) so the target circle is unambiguous.",
    "If unknown, return empty arrays.",
    "Schema keys:",
    "points, segments, circles, triangles, midpoints, pointsOnSegments, parallels, perpendiculars, altitudes, medians, angleBisectors, tangents, incircles, circumcircles, rectangles, squares, parallelograms, trapezoids, circlesByDiameter, pointsOnCircles, namedTangents, perpendicularThroughPointIntersections, tangentIntersections",
    "Problem:",
    problem
  ].join("\n");
}

export async function parseGeometryProblemWithLLM(
  problem: string,
  options: LlmParseOptions = {}
): Promise<GeometryModel> {
  const { apiKey, model, baseUrl } = getApiConfig(options);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a strict geometry information extractor. Return only valid JSON. Do not include markdown code fences."
        },
        {
          role: "user",
          content: buildPrompt(problem)
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API error ${response.status}: ${errText}`);
  }

  const payload = await response.json();
  const contentText = parseChatCompletionContent(payload);
  const jsonObj = extractJsonObject(contentText);
  const extract = geometryExtractSchema.parse(jsonObj);

  return buildModelFromExtract(problem, extract);
}
