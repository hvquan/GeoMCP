import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGeometryPipeline } from "./pipeline/index.js";
import {
  parseGeometryProblem,
  parseGeometryProblemWithLLM,
  parseGeometryDslWithLLM,
  dslToGeometryModel,
  canonicalToGeometryModel,
  expandDslMacros,
  type GeometryDsl
} from "./parsing/index.js";
import { dslToCanonical } from "./dsl/index.js";
import { buildLayout, refineLayoutWithSolver, renderSvg, renderSvgFromCanvasCoords, fitToViewport, applyDrag } from "./geometry/index.js";
import type { CanvasPoint, CanvasSegment, CanvasCircle, ViewportTransform } from "./geometry/index.js";
import { displayLabel } from "./model/normalize.js";
import type { GeometryModel, LayoutModel, Point, AngleMark, RightAngleMark, SegmentMark } from "./model/index.js";

type SolveRequest = {
  sessionId?: string;
  message?: string;
  imageDataUrl?: string;
  parserMode?: "heuristic" | "llm" | "llm-strict" | "dsl-llm" | "dsl-llm-strict";
  solverIterations?: number;
};

type SolveResult = {
  ok: true;
  parserVersion: string;
  recognizedText: string;
  warnings: string[];
  diagnostics: string[];
  svg: string;
  dsl?: GeometryDsl;
  dslExpanded?: GeometryDsl;
  llmDebug?: { prompt: string; rawResponse: string; model: string };
  geo?: GeoCollection;
  viewportTransform?: ViewportTransform;
  pipelineSteps?: Array<{ step: number | string; label: string; data: unknown }>;
  parsed: {
    points: string[];
    circles: GeometryModel["circles"];
    triangles: GeometryModel["triangles"];
    midpoints: GeometryModel["midpoints"];
    pointsOnSegments: GeometryModel["pointsOnSegments"];
    equalLengths: GeometryModel["equalLengths"];
    equalAngles: GeometryModel["equalAngles"];
    displayEqualAngles?: GeometryModel["displayEqualAngles"];
    angleMarks: AngleMark[];
    rightAngleMarks: RightAngleMark[];
    segmentMarks: SegmentMark[];
    altitudes: GeometryModel["altitudes"];
    medians: GeometryModel["medians"];
    angleBisectors: GeometryModel["angleBisectors"];
    centroids: GeometryModel["centroids"];
    parallels: GeometryModel["parallels"];
    circlesByDiameter: GeometryModel["circlesByDiameter"];
    pointsOnCircles: GeometryModel["pointsOnCircles"];
    circleConstraints: GeometryModel["circleConstraints"];
    diameterConstraints: GeometryModel["diameterConstraints"];
    perpendiculars: GeometryModel["perpendiculars"];
    namedTangents: GeometryModel["namedTangents"];
    lines: GeometryModel["lines"];
    lineIntersections: GeometryModel["lineIntersections"];
    perpendicularLines: GeometryModel["perpendicularLines"];
    perpendicularThroughPointIntersections: GeometryModel["perpendicularThroughPointIntersections"];
    tangents: GeometryModel["tangents"];
    tangentIntersections: GeometryModel["tangentIntersections"];
    incircles: GeometryModel["incircles"];
    lineEntities: Array<{ id: string; a: string; b: string }>;
    circleEntities: Array<{ id: string; center: string; radius?: number }>;
    parallelsWithIds: Array<{ line1Id: string; line2Id: string }>;
    perpendicularsWithIds: Array<{ line1Id: string; line2Id: string }>;
    tangentIntersectionsWithIds: Array<{ at: string; circleId?: string; withLineId: string; intersection: string }>;
    namedTangentsWithIds: Array<{ at: string; circleId?: string; linePoint: string }>;
  };
  // Internal — not sent to the client; used to populate session.activeModel/Layout.
  _model?: GeometryModel;
  _layout?: LayoutModel;
};

type ParseDslResult = {
  ok: true;
  parserVersion: string;
  recognizedText: string;
  warnings: string[];
  dsl: GeometryDsl;
  dslExpanded: GeometryDsl;
};

type StreamEvent =
  | { type: "progress"; stage: string; message: string }
  | { type: "step"; step: number | string; label: string; data: unknown }
  | { type: "result"; payload: SolveResult }
  | { type: "error"; message: string };

// ─── GeoJSON-like geometry representation ─────────────────────────────────────

type GeoPoint = {
  type: "Point";
  id: string;
  /** Concrete canvas coordinates. Present in the final (post-layout) collection;
   *  absent in the preliminary (pre-layout) collection. */
  coordinates?: [number, number];
};

type GeoSegment = {
  type: "Segment";
  id: string;
  points: [string, string]; // IDs of the two endpoints
};

type GeoRay = {
  type: "Ray";
  id: string;
  from: string;    // ID of the origin point
  through: string; // ID defining the ray direction
};

type GeoCircle = {
  type: "Circle";
  id: string;
  center: string; // ID of the center point
  radius: number; // world-space radius (scalar — not a point)
};

// Closed polygon (triangle, quadrilateral, ...)
// Vertices listed in order; edges are consecutive pairs + last→first.
type GeoPolygon = {
  type: "Polygon";
  id: string;
  vertices: string[]; // IDs of vertex points, in order
};

type GeoFeature = GeoPoint | GeoSegment | GeoRay | GeoCircle | GeoPolygon;

// ─── Geometric constraints ─

/** Two rays from a common vertex are perpendicular (90°). */
type GeoConstraintRightAngle = {
  type: "RightAngle";
  at: string;   // vertex point ID
  ray1: string; // point ID defining the first ray from `at`
  ray2: string; // point ID defining the second ray from `at`
};

/** Two line segments (referenced by endpoint IDs) are perpendicular. */
type GeoConstraintPerpendicular = {
  type: "Perpendicular";
  line1: [string, string];
  line2: [string, string];
};

/** Two line segments are parallel. */
type GeoConstraintParallel = {
  type: "Parallel";
  line1: [string, string];
  line2: [string, string];
};

/** A set of segments all have the same length. */
type GeoConstraintEqualLength = {
  type: "EqualLength";
  segments: Array<[string, string]>; // each element is [pointA_id, pointB_id]
};

/** A set of angles are equal. Each angle is [ray1_end, vertex, ray2_end]. */
type GeoConstraintEqualAngle = {
  type: "EqualAngle";
  angles: Array<[string, string, string]>; // [arm1, vertex, arm2]
};

/** Distance between two points equals the given scalar value. */
type GeoConstraintDistance = {
  type: "Distance";
  from: string;  // point ID
  to: string;    // point ID
  value: number; // world-space distance
};

/** A point is the midpoint of a segment. */
type GeoConstraintMidpoint = {
  type: "Midpoint";
  point: string;
  segment: [string, string];
};

/** Three or more points lie on the same line. */
type GeoConstraintCollinear = {
  type: "Collinear";
  points: string[]; // IDs of 3+ collinear points, in order along the line
};

type GeoConstraint =
  | GeoConstraintRightAngle
  | GeoConstraintPerpendicular
  | GeoConstraintParallel
  | GeoConstraintEqualLength
  | GeoConstraintEqualAngle
  | GeoConstraintDistance
  | GeoConstraintMidpoint
  | GeoConstraintCollinear;

type GeoCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
  constraints: GeoConstraint[];
};

/*
  Shape + constraint encoding reference
  ======================================

  Circle (O) with diameter CD, radius R
    Circle  { id:"circle:O",  center:"point:O", radius: r }
    Collinear { points: ["point:C","point:O","point:D"] }
    Distance  { from:"point:O", to:"point:C", value: r }
    Distance  { from:"point:O", to:"point:D", value: r }

  Point E on circle (O)
    Distance  { from:"point:E", to:"point:O", value: r }

  Triangle ABC
    Polygon { vertices: ["point:A","point:B","point:C"] }

  Right triangle ∠A=90°
    Polygon { vertices: [...] }
    + RightAngle { at:"point:A", ray1:"point:B", ray2:"point:C" }

  Isosceles triangle (AB=AC)
    Polygon { ... }
    + EqualLength { segments: [["point:A","point:B"],["point:A","point:C"]] }

  Equilateral triangle
    Polygon { ... }
    + EqualLength { segments: [["point:A","point:B"],["point:B","point:C"],["point:C","point:A"]] }

  Parallelogram ABCD  (AB∥DC, AD∥BC)
    Polygon { vertices: [...] }
    + Parallel { line1:["point:A","point:B"], line2:["point:D","point:C"] }
    + Parallel { line1:["point:A","point:D"], line2:["point:B","point:C"] }

  Rectangle ABCD
    Polygon + Parallel×2 + Perpendicular { line1:[A,B], line2:[A,D] }

  Rhombus ABCD
    Polygon + Parallel×2 + EqualLength (all 4 sides)

  Square ABCD
    Polygon + Parallel×2 + Perpendicular + EqualLength (all 4 sides)

  Trapezoid ABCD  (AB∥DC only)
    Polygon + Parallel { line1:[A,B], line2:[D,C] }

  Right trapezoid ABCD  (AB∥DC, ∠A=90°)
    Polygon + Parallel + Perpendicular { line1:[A,B], line2:[A,D] }
*/

type SessionTurn = {
  timestamp: string;
  userText: string;
  recognizedText: string;
  parserVersion: string;
  warnings: string[];
  diagnostics: string[];
  svg: string;
  parsed?: SolveResult["parsed"];
  llmDebug?: SolveResult["llmDebug"];
};

type SessionData = {
  sessionId: string;
  updatedAt: string;
  turns: SessionTurn[];
  // Most-recently solved model + layout — kept in memory for drag re-solves.
  activeModel?: GeometryModel;
  activeLayout?: LayoutModel;
};

type ChatMessage = {
  role: "system" | "user";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const webRoot = join(projectRoot, "web");
const sessions = new Map<string, SessionData>();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSessionId(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) {
    return "default";
  }
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default";
}

function getSession(sessionId: string): SessionData {
  const id = normalizeSessionId(sessionId);
  const existing = sessions.get(id);
  if (existing) {
    return existing;
  }

  const created: SessionData = {
    sessionId: id,
    updatedAt: nowIso(),
    turns: []
  };
  sessions.set(id, created);
  return created;
}

function appendSessionTurn(sessionId: string, turn: SessionTurn): void {
  const session = getSession(sessionId);
  session.turns.push(turn);
  if (session.turns.length > 30) {
    session.turns = session.turns.slice(-30);
  }
  session.updatedAt = nowIso();
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function allowedOrigins(): string[] {
  const raw = (process.env.GEOMCP_ALLOWED_ORIGINS ?? "*").trim();
  if (!raw) {
    return ["*"];
  }
  return raw.split(",").map((it) => it.trim()).filter(Boolean);
}

function corsHeaders(originHeader: string | undefined): Record<string, string> {
  const allow = allowedOrigins();
  const origin = (originHeader ?? "").trim();
  const wildcard = allow.includes("*");
  const isAllowed = wildcard || (origin && allow.includes(origin));

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };

  if (wildcard) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (isAllowed && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return headers;
}

function writeStreamEvent(res: ServerResponse, event: StreamEvent): void {
  res.write(`${JSON.stringify(event)}\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  const max = 10 * 1024 * 1024;

  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > max) {
      throw new Error("Request body too large (max 10MB)");
    }
    chunks.push(b);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  return JSON.parse(raw);
}
function normalizeModelName(model: string): string {
  const name = (model || "").trim();
  if (!name) {
    return "gpt-4.1-mini";
  }

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

function isLocalOpenAICompatibleBaseUrl(baseUrl: string): boolean {
  return /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(baseUrl);
}

function getOpenAIConfig(): { apiKey: string; model: string; baseUrl: string } {
  const baseUrl = (process.env.GEOMCP_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = process.env.GEOMCP_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey && !isLocalOpenAICompatibleBaseUrl(baseUrl)) {
    throw new Error("Missing API key. Set GEOMCP_OPENAI_API_KEY or OPENAI_API_KEY when using hosted APIs.");
  }

  const model = normalizeModelName(process.env.GEOMCP_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini");
  return { apiKey, model, baseUrl };
}

function parseCompletionText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n");
    if (text.trim()) {
      return text;
    }
  }

  throw new Error("Unexpected completion output format");
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointLineDistance(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  return Math.abs(vy * p.x - vx * p.y + b.x * a.y - b.y * a.x) / len;
}

function normalizedDotAbs(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const la = Math.sqrt(a.x * a.x + a.y * a.y) || 1;
  const lb = Math.sqrt(b.x * b.x + b.y * b.y) || 1;
  return Math.abs((a.x * b.x + a.y * b.y) / (la * lb));
}

function normalizedCrossAbs(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const la = Math.sqrt(a.x * a.x + a.y * a.y) || 1;
  const lb = Math.sqrt(b.x * b.x + b.y * b.y) || 1;
  return Math.abs((a.x * b.y - a.y * b.x) / (la * lb));
}

function angleAt(a: Point, b: Point, c: Point): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const lu = Math.sqrt(ux * ux + uy * uy) || 1;
  const lv = Math.sqrt(vx * vx + vy * vy) || 1;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
  return Math.acos(cos);
}

function scoreLayout(model: GeometryModel, layout: LayoutModel): number {
  const byId = new Map(layout.points.map((p) => [p.id, p]));
  const circleCenterById = new Map(
    layout.circles.filter((c) => c.id).map((c) => [c.id as string, c.center])
  );
  let score = 0;

  for (const c of model.circlesByDiameter) {
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    const center = byId.get(c.centerId ?? "point:O");
    if (!a || !b || !center) {
      score += 5;
      continue;
    }
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const r = dist(a, b) / 2;
    score += dist(center, { id: "", x: mx, y: my });
    score += Math.abs(dist(center, a) - r) + Math.abs(dist(center, b) - r);
  }

  for (const rel of model.pointsOnCircles) {
    const p = byId.get(rel.point);
    const centerKey = (rel.circleId && circleCenterById.get(rel.circleId)) || rel.center;
    const o = byId.get(centerKey);
    const circle = layout.circles.find((it) => it.center === centerKey);
    if (!p || !o || !circle) {
      score += 5;
      continue;
    }
    score += Math.abs(dist(p, o) - circle.radius);
  }

  for (const mp of model.midpoints) {
    const p = byId.get(mp.point);
    const a = byId.get(mp.a);
    const b = byId.get(mp.b);
    if (!p || !a || !b) {
      score += 4;
      continue;
    }
    score += dist(p, { id: "", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }

  for (const rel of model.pointsOnSegments) {
    const p = byId.get(rel.point);
    const a = byId.get(rel.a);
    const b = byId.get(rel.b);
    if (!p || !a || !b) {
      score += 3;
      continue;
    }
    score += pointLineDistance(p, a, b);
  }

  for (const alt of model.altitudes) {
    const from = byId.get(alt.from);
    const foot = byId.get(alt.foot);
    const a = byId.get(alt.baseA);
    const b = byId.get(alt.baseB);
    if (!from || !foot || !a || !b) {
      score += 4;
      continue;
    }
    const base = { x: b.x - a.x, y: b.y - a.y };
    const h = { x: foot.x - from.x, y: foot.y - from.y };
    score += normalizedDotAbs(base, h);
    score += pointLineDistance(foot, a, b);
  }

  for (const md of model.medians) {
    const foot = byId.get(md.foot);
    const a = byId.get(md.baseA);
    const b = byId.get(md.baseB);
    if (!foot || !a || !b) {
      score += 3;
      continue;
    }
    score += dist(foot, { id: "", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }

  for (const rel of model.parallels) {
    const a = byId.get(rel.line1.a);
    const b = byId.get(rel.line1.b);
    const c = byId.get(rel.line2.a);
    const d = byId.get(rel.line2.b);
    if (!a || !b || !c || !d) {
      score += 3;
      continue;
    }
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: d.x - c.x, y: d.y - c.y };
    score += normalizedCrossAbs(v1, v2);
  }

  for (const rel of model.perpendiculars) {
    const a = byId.get(rel.line1.a);
    const b = byId.get(rel.line1.b);
    const c = byId.get(rel.line2.a);
    const d = byId.get(rel.line2.b);
    if (!a || !b || !c || !d) {
      score += 3;
      continue;
    }
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: d.x - c.x, y: d.y - c.y };
    score += normalizedDotAbs(v1, v2);
  }

  for (const rel of model.equalLengths) {
    const a = byId.get(rel.segment1.a);
    const b = byId.get(rel.segment1.b);
    const c = byId.get(rel.segment2.a);
    const d = byId.get(rel.segment2.b);
    if (!a || !b || !c || !d) {
      score += 3;
      continue;
    }
    score += Math.abs(dist(a, b) - dist(c, d));
  }

  for (const rel of model.equalAngles) {
    const a1 = byId.get(rel.angle1[0]);
    const b1 = byId.get(rel.angle1[1]);
    const c1 = byId.get(rel.angle1[2]);
    const a2 = byId.get(rel.angle2[0]);
    const b2 = byId.get(rel.angle2[1]);
    const c2 = byId.get(rel.angle2[2]);
    if (!a1 || !b1 || !c1 || !a2 || !b2 || !c2) {
      score += 3;
      continue;
    }
    score += Math.abs(angleAt(a1, b1, c1) - angleAt(a2, b2, c2));
  }

  for (const nt of model.namedTangents) {
    const at = byId.get(nt.at);
    const centerKey =
      (nt.circleId && circleCenterById.get(nt.circleId)) || nt.center || model.circlesByDiameter[0]?.centerId || "point:O";
    const center = byId.get(centerKey);
    const linePoint = byId.get(nt.linePoint);
    if (!at || !center || !linePoint) {
      score += 3;
      continue;
    }
    const radial = { x: at.x - center.x, y: at.y - center.y };
    const tangent = { x: linePoint.x - at.x, y: linePoint.y - at.y };
    score += normalizedDotAbs(radial, tangent);
  }

  return score;
}

/** Build circle entities directly from the parsed model, before the layout
 * solver runs. Radii are taken from `model.circles` when available; circles
 * defined only by a diameter pair (circlesByDiameter) have `radius: undefined`
 * because their size is not known until coordinates are computed. */
function buildPreliminaryCircleEntities(
  model: GeometryModel
): Array<{ id: string; center: string; radius?: number }> {
  const result: Array<{ id: string; center: string; radius?: number }> = [];
  const seenCenters = new Set<string>();

  for (const c of model.circles) {
    const id = c.id ?? c.center;
    if (!seenCenters.has(c.center)) {
      seenCenters.add(c.center);
      result.push({ id, center: c.center, radius: c.radius });
    }
  }

  for (const dc of model.circlesByDiameter) {
    const centerId = dc.centerId ?? "point:O";
    if (!seenCenters.has(centerId)) {
      seenCenters.add(centerId);
      result.push({ id: dc.circleId ?? centerId, center: centerId, radius: undefined });
    }
  }

  return result;
}

function buildGeoCollection(
  model: GeometryModel,
  lineEntities: Array<{ id: string; a: string; b: string }>,
  circleEntities: Array<{ id: string; center: string; radius?: number }>,
  layout?: LayoutModel  // optional — when absent, points have no coordinates
): GeoCollection {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const features: GeoFeature[] = [];
  const constraints: GeoConstraint[] = [];

  // ID prefix rules — every feature type gets a unique namespace:
  //   point:<id>         e.g. "point:O", "point:A"
  //   seg:<lineId>       e.g. "seg:L1"
  //   ray:<from>.<to>    e.g. "ray:C.A"
  //   circle:<circleId>  e.g. "circle:O"
  //   tri:<ABC>          e.g. "tri:AOB"
  //   rect:<ABCD>        e.g. "rect:ABCD"
  //   sq:<ABCD>          e.g. "sq:ABCD"
  //   para:<ABCD>        e.g. "para:ABCD"
  //   trap:<ABCD>        e.g. "trap:ABCD"

  // Helper — IDs are already fully-prefixed after normalizeModelIds; these are identity wrappers.
  const pt = (id: string): string => id;
  // Helper — wrap a pair of already-prefixed point ids into a tuple.
  const pts = (a: string, b: string): [string, string] => [a, b];

  // ─ Points
  // With layout: full coordinates. Without layout: structural IDs only.
  const pointIds: string[] = layout
    ? layout.points.map((p) => p.id)
    : model.points;
  if (layout) {
    for (const p of layout.points) {
      features.push({ type: "Point", id: pt(p.id), coordinates: [round2(p.x), round2(p.y)] });
    }
  } else {
    for (const pid of model.points) {
      features.push({ type: "Point", id: pt(pid) });
    }
  }
  void pointIds; // used above

  // ─ Segments
  for (const seg of lineEntities) {
    features.push({ type: "Segment", id: `seg:${seg.id}`, points: pts(seg.a, seg.b) });
  }

  // ─ Rays (named tangent lines, e.g. Cx)
  const seenRays = new Set<string>();
  for (const nt of model.namedTangents) {
    const id = `ray:${displayLabel(nt.at)}.${displayLabel(nt.linePoint)}`;
    if (seenRays.has(id)) continue;
    seenRays.add(id);
    features.push({ type: "Ray", id, from: nt.at, through: nt.linePoint });
  }

  // ─ Circles — radius is a plain scalar, no separate length feature needed
  const circleFeatureIdByCenter = new Map<string, string>();
  const radiusByCircleId = new Map<string, number>();
  for (const ce of circleEntities) {
    const circleId = ce.id;  // already "circle:O"
    circleFeatureIdByCenter.set(ce.center, circleId);
    const r = round2(ce.radius ?? 0);
    radiusByCircleId.set(ce.id, r);
    features.push({ type: "Circle", id: circleId, center: ce.center, radius: r });
  }

  // ─ Polygons: triangles
  for (const tri of model.triangles) {
    const [a, b, c] = tri.vertices;
    features.push({ type: "Polygon", id: `tri:${displayLabel(a)}${displayLabel(b)}${displayLabel(c)}`, vertices: [a, b, c] });
    if (tri.rightAt) {
      const [r1, r2] = tri.vertices.filter((v) => v !== tri.rightAt) as [string, string];
      constraints.push({ type: "RightAngle", at: pt(tri.rightAt), ray1: pt(r1), ray2: pt(r2) });
    }
    if (tri.equilateral) {
      constraints.push({ type: "EqualLength", segments: [pts(a, b), pts(b, c), pts(c, a)] });
    } else if (tri.isoscelesAt) {
      const apex = tri.isoscelesAt;
      const [b0, b1] = tri.vertices.filter((v) => v !== apex) as [string, string];
      constraints.push({ type: "EqualLength", segments: [pts(apex, b0), pts(apex, b1)] });
    }
  }

  // ─ Polygons: rectangles / squares / parallelograms / trapezoids
  const addQuad = (verts: [string, string, string, string], id: string): void => {
    features.push({ type: "Polygon", id, vertices: verts });
  };

  for (const r of model.rectangles) {
    const [a, b, c, d] = r.vertices;
    addQuad([a, b, c, d], `rect:${displayLabel(a)}${displayLabel(b)}${displayLabel(c)}${displayLabel(d)}`);
    constraints.push({ type: "Parallel",      line1: pts(a, b), line2: pts(d, c) });
    constraints.push({ type: "Parallel",      line1: pts(a, d), line2: pts(b, c) });
    constraints.push({ type: "EqualLength",   segments: [pts(a, b), pts(d, c)] });
    constraints.push({ type: "EqualLength",   segments: [pts(a, d), pts(b, c)] });
    constraints.push({ type: "Perpendicular", line1: pts(a, b), line2: pts(a, d) });
  }

  for (const s of model.squares) {
    const [a, b, c, d] = s.vertices;
    addQuad([a, b, c, d], `sq:${displayLabel(a)}${displayLabel(b)}${displayLabel(c)}${displayLabel(d)}`);
    constraints.push({ type: "Parallel",      line1: pts(a, b), line2: pts(d, c) });
    constraints.push({ type: "Parallel",      line1: pts(a, d), line2: pts(b, c) });
    constraints.push({ type: "EqualLength",   segments: [pts(a, b), pts(b, c), pts(c, d), pts(d, a)] });
    constraints.push({ type: "Perpendicular", line1: pts(a, b), line2: pts(a, d) });
  }

  for (const pg of model.parallelograms) {
    const [a, b, c, d] = pg.vertices;
    addQuad([a, b, c, d], `para:${displayLabel(a)}${displayLabel(b)}${displayLabel(c)}${displayLabel(d)}`);
    constraints.push({ type: "Parallel", line1: pts(a, b), line2: pts(d, c) });
    constraints.push({ type: "Parallel", line1: pts(a, d), line2: pts(b, c) });
  }

  for (const tr of model.trapezoids) {
    const [a, b, c, d] = tr.vertices;
    addQuad([a, b, c, d], `trap:${displayLabel(a)}${displayLabel(b)}${displayLabel(c)}${displayLabel(d)}`);
    constraints.push({ type: "Parallel", line1: pts(a, b), line2: pts(d, c) });
  }

  // ─ Perpendicular constraints
  for (const perp of model.perpendiculars) {
    constraints.push({
      type: "Perpendicular",
      line1: pts(perp.line1.a, perp.line1.b),
      line2: pts(perp.line2.a, perp.line2.b)
    });
  }

  // ─ Parallel constraints
  for (const par of model.parallels) {
    constraints.push({
      type: "Parallel",
      line1: pts(par.line1.a, par.line1.b),
      line2: pts(par.line2.a, par.line2.b)
    });
  }

  // ─ Equal length constraints
  for (const eq of model.equalLengths) {
    constraints.push({
      type: "EqualLength",
      segments: [pts(eq.segment1.a, eq.segment1.b), pts(eq.segment2.a, eq.segment2.b)]
    });
  }

  // ─ Equal angle constraints
  for (const ea of model.equalAngles) {
    const angle = (t: [string, string, string]): [string, string, string] =>
      [pt(t[0]), pt(t[1]), pt(t[2])];
    constraints.push({ type: "EqualAngle", angles: [angle(ea.angle1), angle(ea.angle2)] });
  }

  // ─ Midpoint constraints
  for (const mp of model.midpoints) {
    constraints.push({ type: "Midpoint", point: pt(mp.point), segment: pts(mp.a, mp.b) });
  }

  // ─ Constraints derived from altitude / median / bisector synthesis
  // These may not have a corresponding entry in perpendiculars/midpoints/equalAngles
  // when the LLM emitted a named-line shorthand instead of a raw constraint.
  const seenPerp = new Set(model.perpendiculars.map((p) => [p.line1, p.line2].flatMap(l => [l.a, l.b]).sort().join(":")));
  for (const alt of model.altitudes) {
    const key = [alt.from, alt.foot, alt.baseA, alt.baseB].sort().join(":");
    if (!seenPerp.has(key)) {
      constraints.push({ type: "Perpendicular", line1: pts(alt.from, alt.foot), line2: pts(alt.baseA, alt.baseB) });
    }
  }
  const seenMid = new Set(model.midpoints.map((m) => m.point));
  for (const med of model.medians) {
    if (!seenMid.has(med.foot)) {
      constraints.push({ type: "Midpoint", point: pt(med.foot), segment: pts(med.baseA, med.baseB) });
    }
  }
  const seenEqA = new Set(model.equalAngles.map((ea) => [...ea.angle1, ...ea.angle2].sort().join(":")));
  for (const bis of (model.angleBisectors ?? [])) {
    const angle1: [string, string, string] = [pt(bis.sideA), pt(bis.from), pt(bis.foot)];
    const angle2: [string, string, string] = [pt(bis.foot), pt(bis.from), pt(bis.sideB)];
    const key = [...angle1, ...angle2].sort().join(":");
    if (!seenEqA.has(key)) {
      constraints.push({ type: "EqualAngle", angles: [angle1, angle2] });
    }
  }

  // ─ On-circle constraints → Distance(point, center) = radius value
  for (const poc of model.pointsOnCircles) {
    const r =
      radiusByCircleId.get(poc.circleId ?? "") ??
      radiusByCircleId.get(circleFeatureIdByCenter.get(poc.center) ?? "") ??
      0;
    constraints.push({ type: "Distance", from: poc.point, to: poc.center, value: r });
  }

  // ─ Diameter constraints: C─O─D collinear + OC = OD = R
  for (const dc of model.circlesByDiameter) {
    const centerId = dc.centerId ?? "point:O";
    const r =
      radiusByCircleId.get(dc.circleId ?? "") ??
      radiusByCircleId.get(circleFeatureIdByCenter.get(centerId) ?? "") ??
      0;
    constraints.push({ type: "Collinear", points: [dc.a, centerId, dc.b] });
    constraints.push({ type: "Distance", from: centerId, to: dc.a, value: r });
    constraints.push({ type: "Distance", from: centerId, to: dc.b, value: r });
  }

  // ─ Uniqueness guard
  const seen = new Map<string, string>();
  for (const f of features) {
    const prev = seen.get(f.id);
    if (prev) {
      process.stderr.write(`[GeoCollection] Duplicate feature id "${f.id}" (${prev} vs ${f.type})\n`);
    }
    seen.set(f.id, f.type);
  }

  return { type: "FeatureCollection", features, constraints };
}

function lineKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

function buildLineEntities(model: GeometryModel): {
  lineEntities: Array<{ id: string; a: string; b: string }>;
  lineIdByKey: Map<string, string>;
} {
  const pairByKey = new Map<string, { a: string; b: string }>();
  const add = (a: string, b: string): void => {
    if (!a || !b || a === b) {
      return;
    }
    const [x, y] = [a, b].sort();
    pairByKey.set(`${x}:${y}`, { a: x, b: y });
  };

  for (const s of model.segments) add(s.a, s.b);
  for (const p of model.pointsOnSegments) add(p.a, p.b);
  for (const a of model.altitudes) { add(a.baseA, a.baseB); add(a.from, a.foot); }
  for (const m of model.medians) { add(m.baseA, m.baseB); add(m.from, m.foot); }
  for (const ab of model.angleBisectors) { add(ab.sideA, ab.sideB); add(ab.from, ab.foot); }
  for (const p of model.parallels) {
    add(p.line1.a, p.line1.b);
    add(p.line2.a, p.line2.b);
  }
  for (const p of model.perpendiculars) {
    add(p.line1.a, p.line1.b);
    add(p.line2.a, p.line2.b);
  }
  for (const p of model.perpendicularThroughPointIntersections) {
    add(p.toLine.a, p.toLine.b);
    add(p.withLine.a, p.withLine.b);
  }
  for (const t of model.tangentIntersections) {
    add(t.withLine.a, t.withLine.b);
  }
  for (const n of model.namedTangents) {
    add(n.at, n.linePoint);
  }

  const sorted = [...pairByKey.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const lineIdByKey = new Map<string, string>();
  const lineEntities = sorted.map(([key, pair], idx) => {
    const id = `L${idx + 1}`;
    lineIdByKey.set(key, id);
    return { id, a: pair.a, b: pair.b };
  });

  return { lineEntities, lineIdByKey };
}

function buildCircleEntities(model: GeometryModel, layout: LayoutModel): {
  circleEntities: Array<{ id: string; center: string; radius?: number }>;
  circleIdByCenter: Map<string, string>;
} {
  const centers = new Set<string>();
  for (const c of layout.circles) centers.add(c.center);
  for (const c of model.circlesByDiameter) centers.add(c.centerId ?? "point:O");
  for (const p of model.pointsOnCircles) centers.add(p.center);
  for (const cc of model.circleConstraints) centers.add(cc.centerPointId);
  for (const dc of model.diameterConstraints) centers.add(`point:${displayLabel(dc.circleId)}`);
  for (const n of model.namedTangents) if (n.center) centers.add(n.center);
  for (const t of model.tangentIntersections) if (t.center) centers.add(t.center);

  const radiusByCenter = new Map<string, number>();
  for (const c of layout.circles) {
    const existing = radiusByCenter.get(c.center) ?? 0;
    if (c.radius > existing) radiusByCenter.set(c.center, c.radius);
  }

  // Build a map from center point ID to actual circle id (from model.circles or circlesByDiameter)
  const circleIdForCenter = new Map<string, string>();
  for (const c of model.circles) circleIdForCenter.set(c.center, c.id ?? c.center);
  for (const dc of model.circlesByDiameter) if (dc.centerId) circleIdForCenter.set(dc.centerId, dc.circleId ?? dc.centerId);

  const sortedCenters = [...centers].sort();
  const circleIdByCenter = new Map<string, string>();
  const circleEntities = sortedCenters.map((center) => {
    const id = circleIdForCenter.get(center) ?? center;
    circleIdByCenter.set(center, id);
    return { id, center, radius: radiusByCenter.get(center) };
  });

  return { circleEntities, circleIdByCenter };
}

async function callOpenAIChat(
  messages: ChatMessage[],
  model?: string
): Promise<{ text: string; warning?: string }> {
  const cfg = getOpenAIConfig();
  const postCompletion = async (modelName: string) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }

    return fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        messages
      })
    });
  };

  const requestedRaw = (model ?? cfg.model).trim();
  const requestedModel = normalizeModelName(requestedRaw);
  let selectedModel = requestedModel;
  let response = await postCompletion(selectedModel);
  let fallbackFrom: string | null = null;
  if (!response.ok && response.status === 404) {
    const fallback = nextFallbackModel(selectedModel);
    if (fallback) {
      fallbackFrom = selectedModel;
      selectedModel = fallback;
      response = await postCompletion(selectedModel);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status} (model=${selectedModel}): ${text}`);
  }

  const text = parseCompletionText(await response.json());
  const warningParts: string[] = [];
  if (requestedRaw && requestedRaw !== requestedModel) {
    warningParts.push(`Model '${requestedRaw}' is deprecated; auto-switched to '${requestedModel}'.`);
  }
  if (fallbackFrom && fallbackFrom !== selectedModel) {
    warningParts.push(`Model '${fallbackFrom}' not found; fallback to '${selectedModel}'.`);
  }

  return {
    text,
    warning: warningParts.length ? warningParts.join(" ") : undefined
  };
}

async function extractTextFromImage(imageDataUrl: string): Promise<{ text: string; warning?: string }> {
  const visionModel = normalizeModelName(
    process.env.GEOMCP_VISION_MODEL ?? process.env.GEOMCP_OPENAI_MODEL ?? "gpt-4.1-mini"
  );
  const result = await callOpenAIChat(
    [
      {
        role: "system",
        content:
          "You are OCR + math text extractor. Return only the geometry problem text. Keep point names and symbols exact. No markdown."
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the geometry problem text from this image." },
          { type: "image_url", image_url: { url: imageDataUrl } }
        ]
      }
    ],
    visionModel
  );

  return {
    text: result.text.trim(),
    warning: result.warning
  };
}

function stepLog(
  step: number | string,
  label: string,
  data: unknown,
  onStep?: (step: number | string, label: string, data: unknown) => void
): void {
  const sep = "─".repeat(60);
  const header = `[STEP ${step}] ${label}`;
  process.stdout.write(`\n${sep}\n${header}\n${sep}\n`);
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  onStep?.(step, label, data);
}

async function solveGeometry(
  payload: SolveRequest,
  onProgress?: (stage: string, message: string) => void,
  onStep?: (step: number | string, label: string, data: unknown) => void
): Promise<SolveResult> {
  const message = (payload.message ?? "").trim();
  const imageDataUrl = (payload.imageDataUrl ?? "").trim();
  const parserMode = payload.parserMode ?? "dsl-llm";
  const solverIterations = Math.max(40, Math.min(1200, payload.solverIterations ?? 180));

  if (!message && !imageDataUrl) {
    throw new Error("Please provide text or an image.");
  }

  const warnings: string[] = [];
  let n = 0;           // sequential step counter
  let recognizedText = message;

  // Collect pipeline steps to return in the response
  const pipelineSteps: Array<{ step: number | string; label: string; data: unknown }> = [];
  const collectStep = (step: number | string, label: string, data: unknown) => {
    pipelineSteps.push({ step, label, data });
    onStep?.(step, label, data);
  };

  if (
    parserMode === "llm" ||
    parserMode === "llm-strict" ||
    parserMode === "dsl-llm" ||
    parserMode === "dsl-llm-strict"
  ) {
    const parserModelRaw = (process.env.GEOMCP_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini").trim();
    const parserModelNormalized = normalizeModelName(parserModelRaw);
    if (parserModelRaw && parserModelRaw !== parserModelNormalized) {
      warnings.push(`Model '${parserModelRaw}' is deprecated; auto-switched to '${parserModelNormalized}'.`);
    }
  }

  stepLog(++n, "INPUT (L1)", { parserMode, solverIterations, hasImage: !!imageDataUrl, text: (payload.message ?? "").trim() }, collectStep);

  if (!recognizedText && imageDataUrl) {
    onProgress?.("ocr", "Extracting text from image...");
    const ocr = await extractTextFromImage(imageDataUrl);
    recognizedText = ocr.text;
    if (ocr.warning) {
      warnings.push(ocr.warning);
    }
    if (!recognizedText) {
      throw new Error("Could not extract readable text from the image.");
    }
    stepLog(++n, "OCR → recognizedText", { recognizedText }, collectStep);
  }

  if (recognizedText && imageDataUrl) {
    warnings.push("Image attached: using the typed text as primary input.");
  }

  onProgress?.(
    "parse",
    parserMode === "heuristic"
      ? "Parsing geometry with heuristic parser..."
      : parserMode === "dsl-llm" || parserMode === "dsl-llm-strict"
        ? "Parsing geometry with LLM -> DSL (constraint-based)..."
        : "Parsing geometry with LLM JSON schema..."
  );
  const pipelineResult = await runGeometryPipeline(recognizedText, {
    parserMode,
    parseOnly: true,
    fallbackToHeuristic: parserMode !== "dsl-llm-strict" && parserMode !== "llm-strict",
  });
  let parsed = pipelineResult.parsed;
  let parserVersion = pipelineResult.parserVersion;
  const { dsl, dslExpanded, llmDebug } = pipelineResult;
  warnings.push(...pipelineResult.warnings);

  // Emit debug step logs from pipeline intermediates
  if (llmDebug) {
    const parseFailed = pipelineResult.warnings.some(w => w.startsWith("DSL parser fallback"));
    stepLog(++n, `prompt → LLM (L4 few-shots + L5 adapter, model: ${llmDebug.model})`, llmDebug.prompt, collectStep);
    stepLog(++n, parseFailed ? "raw LLM response — parse FAILED (L6 extractor)" : "raw LLM response (L6 extractor)", llmDebug.rawResponse, collectStep);
  }
  if (dsl) stepLog(++n, "LLM → DSL JSON (L8 schema validation + L9 normalize)", dsl, collectStep);
  if (dslExpanded) stepLog(++n, "expand DSL macros (L11 desugar)", dslExpanded, collectStep);
  stepLog(++n, "DSL → GeometryModel (L12 runtime compiler)", parsed, collectStep);

  onProgress?.("solve", "Applying relation enrichment and constraint solver...");

  // Step 5b — identify geometric objects + assign IDs + extract constraints.
  // Runs directly on the parsed model, before the layout solver, so coordinates
  // and radii are not yet available (GeoPoint.coordinates / GeoLength.value absent).
  const { lineEntities: prelimLineEntities } = buildLineEntities(parsed);
  const prelimCircleEntities = buildPreliminaryCircleEntities(parsed);
  const geoStructure = buildGeoCollection(parsed, prelimLineEntities, prelimCircleEntities);
  stepLog(++n, "identify objects + extract constraints pre-layout (L13)", geoStructure, collectStep);

  const baseLayout = buildLayout(parsed);
  stepLog(++n, "buildLayout → baseLayout (L14)", { points: baseLayout.points, circles: baseLayout.circles, diagnostics: baseLayout.diagnostics }, collectStep);
  const refinedLayout = refineLayoutWithSolver(parsed, baseLayout, { iterations: solverIterations });
  stepLog(++n, "refineLayoutWithSolver → refinedLayout (L13 solver)", { points: refinedLayout.points, circles: refinedLayout.circles, diagnostics: refinedLayout.diagnostics }, collectStep);

  // Keep the solution that better satisfies geometric constraints.
  const baseScore = scoreLayout(parsed, baseLayout);
  const refinedScore = scoreLayout(parsed, refinedLayout);
  const layout = refinedScore <= baseScore ? refinedLayout : baseLayout;
  stepLog(++n, "scoreLayout → select winner", { baseScore, refinedScore, winner: refinedScore <= baseScore ? "refined" : "base" }, collectStep);
  if (refinedScore > baseScore) {
    warnings.push("Solver refinement skipped: base layout satisfies constraints better.");
  }
  warnings.push(`Constraint score (base=${baseScore.toFixed(3)}, refined=${refinedScore.toFixed(3)}).`);

  onProgress?.("render", "Rendering SVG diagram...");

  // Step 9b — fit layout bounding box to canvas viewport.
  const fit = fitToViewport(layout);
  stepLog(++n, "fitToViewport → bounding box + canvas transform (L14)", {
    boundingBox: {
      minX: Math.round(fit.boundingBox.minX * 100) / 100,
      minY: Math.round(fit.boundingBox.minY * 100) / 100,
      maxX: Math.round(fit.boundingBox.maxX * 100) / 100,
      maxY: Math.round(fit.boundingBox.maxY * 100) / 100,
      width:  Math.round(fit.boundingBox.width  * 100) / 100,
      height: Math.round(fit.boundingBox.height * 100) / 100,
      center: {
        x: Math.round(fit.boundingBox.center.x * 100) / 100,
        y: Math.round(fit.boundingBox.center.y * 100) / 100,
      },
    },
    transform: {
      scale:   Math.round(fit.transform.scale   * 10000) / 10000,
      offsetX: Math.round(fit.transform.offsetX * 100)   / 100,
      offsetY: Math.round(fit.transform.offsetY * 100)   / 100,
      canvas: `${fit.transform.canvasWidth} × ${fit.transform.canvasHeight}`,
      padding: fit.transform.padding,
    },
  }, collectStep);

  stepLog(++n, "scene graph nodes (L15 — before SVG render)", {
    points: layout.points.map(p => ({ id: p.id, x: Math.round(p.x*100)/100, y: Math.round(p.y*100)/100 })),
    nodes: layout.nodes,
    angleMarks: layout.angleMarks ?? [],
    rightAngleMarks: layout.rightAngleMarks ?? [],
    segmentMarks: layout.segmentMarks ?? [],
  }, collectStep);

  const svg = renderSvg(layout);
  stepLog(++n, "renderSvg → SVG (L16)", { svgLength: svg.length, preview: svg.slice(0, 200) + "..." }, collectStep);

  const { lineEntities, lineIdByKey } = buildLineEntities(parsed);
  const { circleEntities, circleIdByCenter } = buildCircleEntities(parsed, layout);
  stepLog(++n, "build scene graph entities (L15)", { lineEntities, circleEntities }, collectStep);

  // Step 12 — hydrate the GeoCollection with concrete coordinates + radii from layout.
  const geo = buildGeoCollection(parsed, lineEntities, circleEntities, layout);
  stepLog(++n, "hydrate GeoCollection → final output", geo, collectStep);

  return {
    ok: true,
    parserVersion,
    recognizedText,
    warnings,
    diagnostics: layout.diagnostics,
    svg,
    dsl,
    dslExpanded,
    geo,
    pipelineSteps,
    parsed: {
      points: parsed.points,
      circles: parsed.circles,
      triangles: parsed.triangles,
      midpoints: parsed.midpoints,
      pointsOnSegments: parsed.pointsOnSegments,
      equalLengths: parsed.equalLengths,
      equalAngles: parsed.equalAngles,
      ...(parsed.displayEqualAngles?.length && { displayEqualAngles: parsed.displayEqualAngles }),
      angleMarks: layout.angleMarks ?? [],
      rightAngleMarks: layout.rightAngleMarks ?? [],
      segmentMarks: layout.segmentMarks ?? [],
      altitudes: parsed.altitudes,
      medians: parsed.medians,
      angleBisectors: parsed.angleBisectors,
      centroids: parsed.centroids,
      parallels: parsed.parallels,
      circlesByDiameter: parsed.circlesByDiameter,
      pointsOnCircles: parsed.pointsOnCircles,
      circleConstraints: parsed.circleConstraints,
      diameterConstraints: parsed.diameterConstraints,
      perpendiculars: parsed.perpendiculars,
      namedTangents: parsed.namedTangents,
      lines: parsed.lines,
      lineIntersections: parsed.lineIntersections,
      perpendicularLines: parsed.perpendicularLines,
      perpendicularThroughPointIntersections: parsed.perpendicularThroughPointIntersections,
      tangents: parsed.tangents,
      tangentIntersections: parsed.tangentIntersections,
      incircles: parsed.incircles,
      lineEntities,
      circleEntities,
      parallelsWithIds: parsed.parallels.map((p) => ({
        line1Id: lineIdByKey.get(lineKey(p.line1.a, p.line1.b)) ?? "",
        line2Id: lineIdByKey.get(lineKey(p.line2.a, p.line2.b)) ?? ""
      })),
      perpendicularsWithIds: parsed.perpendiculars.map((p) => ({
        line1Id: lineIdByKey.get(lineKey(p.line1.a, p.line1.b)) ?? "",
        line2Id: lineIdByKey.get(lineKey(p.line2.a, p.line2.b)) ?? ""
      })),
      tangentIntersectionsWithIds: parsed.tangentIntersections.map((t) => ({
        at: t.at,
        circleId: t.center ? circleIdByCenter.get(t.center) : circleIdByCenter.get(parsed.circlesByDiameter[0]?.centerId ?? "point:O"),
        withLineId: lineIdByKey.get(lineKey(t.withLine.a, t.withLine.b)) ?? "",
        intersection: t.intersection
      })),
      namedTangentsWithIds: parsed.namedTangents.map((n) => ({
        at: n.at,
        circleId: n.center ? circleIdByCenter.get(n.center) : circleIdByCenter.get(parsed.circlesByDiameter[0]?.centerId ?? "point:O"),
        linePoint: n.linePoint
      }))
    },
    llmDebug,
    viewportTransform: fit.transform,
    _model: parsed,
    _layout: layout,
  };
}

// ─── Patch / incremental update ──────────────────────────────────────────────

type PatchRequest = {
  sessionId?: string;
  message: string;
  existingParsed: SolveResult["parsed"];
  existingPoints: CanvasPoint[];          // current SVG-canvas coords from frontend
  existingSegments: CanvasSegment[];      // current visual segments from SVG
  existingCircles: CanvasCircle[];        // current circles from SVG
  parserMode?: SolveRequest["parserMode"];
};

function getDrawableSegments(model: GeometryModel): CanvasSegment[] {
  const seen = new Set<string>();
  const result: CanvasSegment[] = [];
  const add = (a: string, b: string): void => {
    const key = [a, b].sort().join(":");
    if (!a || !b || a === b || seen.has(key)) return;
    seen.add(key);
    result.push({ a, b });
  };
  for (const s of model.segments) add(s.a, s.b);
  for (const t of model.triangles) {
    const [a, b, c] = t.vertices;
    add(a, b); add(a, c); add(b, c);
  }
  for (const l of model.lines) {
    const a = l.a ?? l.point1Id;
    const b = l.b ?? l.point2Id;
    if (a && b) add(a, b);
  }
  return result;
}

// Compute canvas positions for derived points (midpoints, intersections, feet)
// that don't yet appear in the positions map.
function computeDerivedPositions(
  model: GeometryModel,
  pos: Map<string, { x: number; y: number }>
): void {
  const get = (id: string) => pos.get(id.toUpperCase());
  const set = (id: string, x: number, y: number) =>
    pos.set(id.toUpperCase(), { x, y });

  // Midpoints
  for (const mp of model.midpoints) {
    if (get(mp.point)) continue;
    const a = get(mp.a), b = get(mp.b);
    if (a && b) set(mp.point, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }

  // Altitudes — foot of perpendicular from vertex to base
  const projectFoot = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
    return { x: a.x + t * vx, y: a.y + t * vy };
  };
  for (const alt of model.altitudes) {
    if (get(alt.foot)) continue;
    const from = get(alt.from), baseA = get(alt.baseA), baseB = get(alt.baseB);
    if (from && baseA && baseB) {
      const foot = projectFoot(from, baseA, baseB);
      set(alt.foot, foot.x, foot.y);
    }
  }
  // Medians — foot is midpoint of base
  for (const md of model.medians) {
    if (get(md.foot)) continue;
    const baseA = get(md.baseA), baseB = get(md.baseB);
    if (baseA && baseB) set(md.foot, (baseA.x + baseB.x) / 2, (baseA.y + baseB.y) / 2);
  }
  // Angle bisectors — foot divides base by ratio |from-sideA| : |from-sideB| (angle bisector theorem)
  for (const bis of (model.angleBisectors ?? [])) {
    if (get(bis.foot)) continue;
    const from = get(bis.from), sideA = get(bis.sideA), sideB = get(bis.sideB);
    if (!from || !sideA || !sideB) continue;
    const da = Math.hypot(from.x - sideA.x, from.y - sideA.y);
    const db = Math.hypot(from.x - sideB.x, from.y - sideB.y);
    if (da + db < 1e-9) continue;
    const t = da / (da + db);
    set(bis.foot, sideA.x + t * (sideB.x - sideA.x), sideA.y + t * (sideB.y - sideA.y));
  }

  // Line intersections
  const lineIntersect = (
    a1: { x: number; y: number }, a2: { x: number; y: number },
    b1: { x: number; y: number }, b2: { x: number; y: number }
  ) => {
    const den = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
    if (Math.abs(den) < 1e-9) return null;
    const px = ((a1.x * a2.y - a1.y * a2.x) * (b1.x - b2.x) - (a1.x - a2.x) * (b1.x * b2.y - b1.y * b2.x)) / den;
    const py = ((a1.x * a2.y - a1.y * a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x * b2.y - b1.y * b2.x)) / den;
    return { x: px, y: py };
  };
  // Line intersections
  const lineRefById = new Map(
    model.lines
      .filter((l) => l.id && l.a && l.b)
      .map((l) => [l.id, { a: l.a as string, b: l.b as string }])
  );
  for (const li of model.lineIntersections) {
    if (get(li.point)) continue;
    const l1 = lineRefById.get(li.line1);
    const l2 = lineRefById.get(li.line2);
    if (l1 && l2) {
      const a1 = get(l1.a), a2 = get(l1.b), b1 = get(l2.a), b2 = get(l2.b);
      if (a1 && a2 && b1 && b2) {
        const hit = lineIntersect(a1, a2, b1, b2);
        if (hit) set(li.point, hit.x, hit.y);
      }
    }
  }
}

function mergePatchedParsed(
  base: SolveResult["parsed"],
  delta: GeometryModel
): SolveResult["parsed"] {
  function addUniq<T>(arr: T[], items: T[], key: (t: T) => string): T[] {
    const m = new Map(arr.map((t) => [key(t), t]));
    for (const t of items) if (!m.has(key(t))) m.set(key(t), t);
    return [...m.values()];
  }
  const sk = (a: string, b: string) => [a, b].sort().join(":");
  return {
    ...base,
    points: [...new Set([...base.points, ...delta.points])],
    triangles: addUniq(base.triangles, delta.triangles, (t) => t.vertices.slice().sort().join(":")),
    circles: addUniq(base.circles, delta.circles, (c) => c.center),
    midpoints: addUniq(base.midpoints, delta.midpoints, (m) => m.point),
    pointsOnSegments: addUniq(base.pointsOnSegments, delta.pointsOnSegments, (r) => `${r.point}:${sk(r.a, r.b)}`),
    lineIntersections: addUniq(base.lineIntersections, delta.lineIntersections, (r) => r.point),
    perpendiculars: [...base.perpendiculars, ...delta.perpendiculars],
    parallels: [...base.parallels, ...delta.parallels],
    circlesByDiameter: addUniq(base.circlesByDiameter, delta.circlesByDiameter, (c) => c.centerId ?? sk(c.a, c.b)),
    pointsOnCircles: addUniq(base.pointsOnCircles, delta.pointsOnCircles, (r) => `${r.point}:${r.center}`),
    namedTangents: addUniq(base.namedTangents, delta.namedTangents, (n) => `${n.at}:${n.linePoint}`),
    tangentIntersections: addUniq(base.tangentIntersections, delta.tangentIntersections, (t) => `${t.at}:${t.intersection}`),
    lines: addUniq(base.lines, delta.lines, (l) => l.id),
    lineEntities: addUniq(
      base.lineEntities,
      delta.segments.map((s, i) => ({ id: `LP${i + base.lineEntities.length}`, a: s.a, b: s.b })),
      (l) => sk(l.a, l.b)
    ),
    // keep enriched fields from base (they don't change for existing elements):
    altitudes: addUniq(base.altitudes ?? [], delta.altitudes, (a) => `${a.from}:${a.foot}`),
    medians: addUniq(base.medians ?? [], delta.medians, (m) => `${m.from}:${m.foot}`),
    angleBisectors: addUniq(base.angleBisectors ?? [], delta.angleBisectors, (a) => `${a.from}:${a.foot}`),
    centroids: addUniq(base.centroids ?? [], delta.centroids ?? [], (c) => c.point),
    perpendicularThroughPointIntersections: addUniq(
      base.perpendicularThroughPointIntersections,
      delta.perpendicularThroughPointIntersections,
      (r) => r.intersection
    ),
  };
}

async function handlePatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(req)) as PatchRequest;
  const sessionId = normalizeSessionId(payload.sessionId);
  const patchMessage = (payload.message ?? "").trim();

  if (!patchMessage) {
    json(res, 400, { error: "message is required" });
    return;
  }
  if (!payload.existingParsed) {
    json(res, 400, { error: "existingParsed is required" });
    return;
  }

  const existingPoints: CanvasPoint[] = Array.isArray(payload.existingPoints) ? payload.existingPoints : [];
  const existingSegments: CanvasSegment[] = Array.isArray(payload.existingSegments) ? payload.existingSegments : [];
  const existingCircles: CanvasCircle[] = Array.isArray(payload.existingCircles) ? payload.existingCircles : [];

  // Build mutable position map from current SVG-canvas coordinates.
  const positions = new Map<string, { x: number; y: number }>();
  for (const p of existingPoints) positions.set(String(p.id).toUpperCase(), { x: p.x, y: p.y });

  // Re-apply existing geometric constraints (altitude feet, median midpoints, bisector feet)
  // so that dragging a triangle vertex keeps derived points correctly positioned.
  // Clear their stale positions first so computeDerivedPositions recomputes them fresh.
  const ep = payload.existingParsed as unknown as GeometryModel;
  const derivedIds = new Set<string>();
  for (const alt of ep.altitudes ?? []) derivedIds.add(alt.foot.toUpperCase());
  for (const med of ep.medians ?? []) derivedIds.add(med.foot.toUpperCase());
  for (const bis of ep.angleBisectors ?? []) derivedIds.add(bis.foot.toUpperCase());
  for (const mp of ep.midpoints ?? []) derivedIds.add(mp.point.toUpperCase());
  for (const li of ep.lineIntersections ?? []) derivedIds.add(li.point.toUpperCase());
  for (const id of derivedIds) positions.delete(id);
  computeDerivedPositions(ep, positions);

  // Parse the incremental instruction.
  const parserMode = payload.parserMode ?? "dsl-llm";
  let deltaModel: GeometryModel;
  try {
    const dsl = await parseGeometryDslWithLLM(patchMessage);
    const canonical = dslToCanonical(dsl);
    deltaModel = canonicalToGeometryModel(canonical, patchMessage);
  } catch {
    // Fallback: heuristic parser
    deltaModel = parseGeometryProblem(patchMessage);
  }

  // Derive canvas positions for new points introduced by delta.
  computeDerivedPositions(deltaModel, positions);

  // Merge segment lists (existing + new from delta, dedup by sorted endpoint key).
  const existingSegKeys = new Set(existingSegments.map((s) => [s.a, s.b].sort().join(":")));
  const allSegments: CanvasSegment[] = [...existingSegments];
  for (const seg of getDrawableSegments(deltaModel)) {
    const key = [seg.a, seg.b].sort().join(":");
    if (!existingSegKeys.has(key)) {
      allSegments.push(seg);
      existingSegKeys.add(key);
    }
  }

  // Merge circles (existing + new from delta).
  const existingCircleCenters = new Set(existingCircles.map((c) => c.centerId.toUpperCase()));
  const allCircles: CanvasCircle[] = [...existingCircles];
  for (const dc of deltaModel.circlesByDiameter) {
    const centerId = dc.centerId ?? "point:O";
    if (existingCircleCenters.has(centerId.toUpperCase())) continue;
    const centerPos = positions.get(centerId.toUpperCase());
    const aPos = positions.get(dc.a.toUpperCase());
    if (centerPos && aPos) {
      const dx = aPos.x - centerPos.x, dy = aPos.y - centerPos.y;
      allCircles.push({ centerId, r: Math.sqrt(dx * dx + dy * dy) });
      existingCircleCenters.add(centerId.toUpperCase());
    }
  }

  // Collect all point entries (existing + any new derived points).
  // Filter out synthetic browser-only anchors (R_* prefix) — those are added by the JS
  // canvas layer and must not be re-emitted by server-rendered SVG.
  const realExistingPoints = existingPoints.filter((p) => !p.id.toUpperCase().startsWith("R_"));
  const allPointIds = new Set(realExistingPoints.map((p) => p.id.toUpperCase()));
  // Apply recomputed derived positions (M, H, K, ...) back into the point list.
  const allPoints: CanvasPoint[] = realExistingPoints.map((p) => {
    const updated = derivedIds.has(p.id.toUpperCase()) ? positions.get(p.id.toUpperCase()) : undefined;
    return updated ? { id: p.id, x: updated.x, y: updated.y } : p;
  });
  for (const pid of deltaModel.points) {
    if (allPointIds.has(pid.toUpperCase())) continue;
    const p = positions.get(pid.toUpperCase());
    if (p) {
      allPoints.push({ id: pid, x: p.x, y: p.y });
      allPointIds.add(pid.toUpperCase());
    }
  }

  // Render full updated SVG.
  const svg = renderSvgFromCanvasCoords(allPoints, allSegments, allCircles);

  // Merge parsed constraint data.
  const updatedParsed = mergePatchedParsed(payload.existingParsed, deltaModel);

  appendSessionTurn(sessionId, {
    timestamp: nowIso(),
    userText: patchMessage,
    recognizedText: patchMessage,
    parserVersion: "patch",
    warnings: [],
    diagnostics: [],
    svg,
    parsed: updatedParsed
  });

  json(res, 200, {
    ok: true,
    parserVersion: "patch",
    recognizedText: patchMessage,
    warnings: [],
    diagnostics: [],
    svg,
    parsed: updatedParsed
  });
}

async function parseDslOnly(payload: SolveRequest): Promise<ParseDslResult> {
  const recognizedText = (payload.message ?? "").trim();
  if (!recognizedText) {
    throw new Error("Please provide text to parse.");
  }

  const dsl = await parseGeometryDslWithLLM(recognizedText);
  const dslExpanded = expandDslMacros(dsl);

  return {
    ok: true,
    parserVersion: "v3-dsl-parse-only",
    recognizedText,
    warnings: [],
    dsl,
    dslExpanded
  };
}

function pickMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "text/plain; charset=utf-8";
}

// ─── Drag re-solve ────────────────────────────────────────────────────────────

type DragRequest = {
  sessionId?: string;
  pointId: string;
  x: number;
  y: number;
};

async function handleDrag(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(req)) as DragRequest;
  const sessionId = normalizeSessionId(payload.sessionId);
  const { pointId, x, y } = payload;

  if (!pointId || typeof x !== "number" || typeof y !== "number") {
    json(res, 400, { error: "pointId, x, and y are required" });
    return;
  }

  const session = getSession(sessionId);
  if (!session.activeModel || !session.activeLayout) {
    json(res, 409, { error: "No solved layout in session — call /api/solve first" });
    return;
  }

  const newLayout = applyDrag(session.activeModel, session.activeLayout, pointId, x, y);
  // Update the session so subsequent drags build on the latest positions.
  session.activeLayout = newLayout;

  const svg = renderSvg(newLayout);
  json(res, 200, { ok: true, svg, diagnostics: newLayout.diagnostics });
}

async function handleSolve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(req)) as SolveRequest;
  const sessionId = normalizeSessionId(payload.sessionId);
  const userText = (payload.message ?? "").trim() || "[image upload]";
  const result = await solveGeometry(payload);

  // Store model + layout for subsequent drag re-solves.
  if (result._model && result._layout) {
    const session = getSession(sessionId);
    session.activeModel = result._model;
    session.activeLayout = result._layout;
  }

  appendSessionTurn(sessionId, {
    timestamp: nowIso(),
    userText,
    recognizedText: result.recognizedText,
    parserVersion: result.parserVersion,
    warnings: result.warnings,
    diagnostics: result.diagnostics,
    svg: result.svg,
    parsed: result.parsed
  });

  json(res, 200, result);
}

async function handleParseDsl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(req)) as SolveRequest;
  const result = await parseDslOnly(payload);
  json(res, 200, result);
}

// ─── DSL Replay — skip LLM, test pipeline from raw DSL ───────────────────────

async function handleReplayDsl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(req)) as {
    sessionId?: string;
    /** Raw DSL JSON string  OR already-parsed DSL object */
    dsl: string | Record<string, unknown>;
    /** Optional: original problem text (used as rawText for compiler) */
    input?: string;
    solverIterations?: number;
  };

  const sessionId = normalizeSessionId(payload.sessionId);

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  let n = 0;

  try {
    writeStreamEvent(res, { type: "progress", stage: "start", message: "DSL replay started." });

    // Parse DSL string if needed
    let rawDsl: Record<string, unknown>;
    if (typeof payload.dsl === "string") {
      // Strip JSONC comments
      const stripped = payload.dsl
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      rawDsl = JSON.parse(stripped);
    } else {
      rawDsl = payload.dsl;
    }

    const input = (payload.input ?? "").trim();
    const solverIterations = Math.max(40, Math.min(1200, payload.solverIterations ?? 180));

    stepLog(++n, "INPUT (replay — no LLM)", { input, solverIterations, dsl: rawDsl },
      (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    writeStreamEvent(res, { type: "progress", stage: "parse", message: "Compiling DSL…" });

    const dslExpanded = expandDslMacros(rawDsl as any);
    stepLog(++n, "expand DSL macros (L11 desugar)", dslExpanded,
      (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    const parsed = dslToGeometryModel(dslExpanded, input);
    stepLog(++n, "DSL → GeometryModel (L12 runtime compiler)", parsed,
      (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    writeStreamEvent(res, { type: "progress", stage: "solve", message: "Solving constraints…" });

    const { lineEntities: prelimLineEntities } = buildLineEntities(parsed);
    const prelimCircleEntities = buildPreliminaryCircleEntities(parsed);
    const geoStructure = buildGeoCollection(parsed, prelimLineEntities, prelimCircleEntities);
    stepLog(++n, "identify objects + extract constraints pre-layout (L13)", geoStructure,
      (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    const baseLayout = buildLayout(parsed);
    stepLog(++n, "buildLayout → baseLayout (L14)", { points: baseLayout.points, circles: baseLayout.circles, diagnostics: baseLayout.diagnostics },
      (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    const refinedLayout = refineLayoutWithSolver(parsed, baseLayout, { iterations: solverIterations });
    stepLog(++n, "refineLayoutWithSolver → refinedLayout (L13 solver)", { points: refinedLayout.points, circles: refinedLayout.circles, diagnostics: refinedLayout.diagnostics },
      (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    const baseScore = scoreLayout(parsed, baseLayout);
    const refinedScore = scoreLayout(parsed, refinedLayout);
    const layout = refinedScore <= baseScore ? refinedLayout : baseLayout;
    const warnings: string[] = [`Constraint score (base=${baseScore.toFixed(3)}, refined=${refinedScore.toFixed(3)}).`];
    stepLog(++n, "scoreLayout → select winner", { baseScore, refinedScore, winner: refinedScore <= baseScore ? "refined" : "base" },
      (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    writeStreamEvent(res, { type: "progress", stage: "render", message: "Rendering SVG…" });

    const fit = fitToViewport(layout);
    stepLog(++n, "fitToViewport → bounding box + canvas transform (L14)", {
      boundingBox: {
        minX: Math.round(fit.boundingBox.minX * 100) / 100,
        minY: Math.round(fit.boundingBox.minY * 100) / 100,
        maxX: Math.round(fit.boundingBox.maxX * 100) / 100,
        maxY: Math.round(fit.boundingBox.maxY * 100) / 100,
        width:  Math.round(fit.boundingBox.width  * 100) / 100,
        height: Math.round(fit.boundingBox.height * 100) / 100,
      },
      transform: {
        scale:   Math.round(fit.transform.scale   * 10000) / 10000,
        offsetX: Math.round(fit.transform.offsetX * 100)   / 100,
        offsetY: Math.round(fit.transform.offsetY * 100)   / 100,
        canvas: `${fit.transform.canvasWidth} × ${fit.transform.canvasHeight}`,
      },
    }, (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    stepLog(++n, "scene graph nodes (L15 — before SVG render)", {
      points: layout.points.map(p => ({ id: p.id, x: Math.round(p.x*100)/100, y: Math.round(p.y*100)/100 })),
      nodes: layout.nodes,
      angleMarks: layout.angleMarks ?? [],
      rightAngleMarks: layout.rightAngleMarks ?? [],
      segmentMarks: layout.segmentMarks ?? [],
    }, (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    const svg = renderSvg(layout);
    stepLog(++n, "renderSvg → SVG (L16)", { svgLength: svg.length, preview: svg.slice(0, 200) + "..." },
      (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    const { lineEntities, lineIdByKey } = buildLineEntities(parsed);
    const { circleEntities, circleIdByCenter } = buildCircleEntities(parsed, layout);
    const geo = buildGeoCollection(parsed, lineEntities, circleEntities, layout);
    stepLog(++n, "hydrate GeoCollection → final output", geo,
      (step, label, data) => writeStreamEvent(res, { type: "step", step, label, data }));

    const result: SolveResult = {
      ok: true,
      parserVersion: "v3-dsl-replay",
      recognizedText: input || "(DSL replay)",
      warnings,
      diagnostics: layout.diagnostics,
      svg,
      dsl: rawDsl as any,
      dslExpanded,
      geo,
      parsed: {
        points: parsed.points,
        circles: parsed.circles,
        triangles: parsed.triangles,
        midpoints: parsed.midpoints,
        pointsOnSegments: parsed.pointsOnSegments,
        equalLengths: parsed.equalLengths,
        equalAngles: parsed.equalAngles,
        ...(parsed.displayEqualAngles?.length && { displayEqualAngles: parsed.displayEqualAngles }),
        angleMarks: layout.angleMarks ?? [],
        rightAngleMarks: layout.rightAngleMarks ?? [],
        segmentMarks: layout.segmentMarks ?? [],
        altitudes: parsed.altitudes,
        medians: parsed.medians,
        angleBisectors: parsed.angleBisectors,
        centroids: parsed.centroids,
        parallels: parsed.parallels,
        circlesByDiameter: parsed.circlesByDiameter,
        pointsOnCircles: parsed.pointsOnCircles,
        circleConstraints: parsed.circleConstraints,
        diameterConstraints: parsed.diameterConstraints,
        perpendiculars: parsed.perpendiculars,
        namedTangents: parsed.namedTangents,
        lines: parsed.lines,
        lineIntersections: parsed.lineIntersections,
        perpendicularLines: parsed.perpendicularLines,
        perpendicularThroughPointIntersections: parsed.perpendicularThroughPointIntersections,
        tangents: parsed.tangents,
        tangentIntersections: parsed.tangentIntersections,
        incircles: parsed.incircles,
        lineEntities,
        circleEntities,
        parallelsWithIds: parsed.parallels.map((p) => ({
          line1Id: lineIdByKey.get(lineKey(p.line1.a, p.line1.b)) ?? "",
          line2Id: lineIdByKey.get(lineKey(p.line2.a, p.line2.b)) ?? ""
        })),
        perpendicularsWithIds: parsed.perpendiculars.map((p) => ({
          line1Id: lineIdByKey.get(lineKey(p.line1.a, p.line1.b)) ?? "",
          line2Id: lineIdByKey.get(lineKey(p.line2.a, p.line2.b)) ?? ""
        })),
        tangentIntersectionsWithIds: parsed.tangentIntersections.map((t) => ({
          at: t.at,
          circleId: t.center ? circleIdByCenter.get(t.center) : circleIdByCenter.get(parsed.circlesByDiameter[0]?.centerId ?? "point:O"),
          withLineId: lineIdByKey.get(lineKey(t.withLine.a, t.withLine.b)) ?? "",
          intersection: t.intersection
        })),
        namedTangentsWithIds: parsed.namedTangents.map((n) => ({
          at: n.at,
          circleId: n.center ? circleIdByCenter.get(n.center) : circleIdByCenter.get(parsed.circlesByDiameter[0]?.centerId ?? "point:O"),
          linePoint: n.linePoint
        }))
      },
      viewportTransform: fit.transform,
      _model: parsed,
      _layout: layout,
    };

    // Store model + layout for subsequent drag re-solves.
    const session = getSession(sessionId);
    session.activeModel = parsed;
    session.activeLayout = layout;

    appendSessionTurn(sessionId, {
      timestamp: nowIso(),
      userText: `[DSL replay] ${input || ""}`,
      recognizedText: result.recognizedText,
      parserVersion: result.parserVersion,
      warnings: result.warnings,
      diagnostics: result.diagnostics,
      svg: result.svg,
    });

    writeStreamEvent(res, { type: "result", payload: result });
  } catch (error) {
    writeStreamEvent(res, {
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    res.end();
  }
}

async function handleSolveStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(req)) as SolveRequest;
  const sessionId = normalizeSessionId(payload.sessionId);
  const userText = (payload.message ?? "").trim() || "[image upload]";

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  try {
    writeStreamEvent(res, { type: "progress", stage: "start", message: "Request received." });
    const result = await solveGeometry(
      payload,
      (stage, message) => {
        writeStreamEvent(res, { type: "progress", stage, message });
      },
      (step, label, data) => {
        writeStreamEvent(res, { type: "step", step, label, data });
      }
    );

    // Store model + layout for subsequent drag re-solves.
    if (result._model && result._layout) {
      const session = getSession(sessionId);
      session.activeModel = result._model;
      session.activeLayout = result._layout;
    }

    appendSessionTurn(sessionId, {
      timestamp: nowIso(),
      userText,
      recognizedText: result.recognizedText,
      parserVersion: result.parserVersion,
      warnings: result.warnings,
      diagnostics: result.diagnostics,
      svg: result.svg,
      parsed: result.parsed,
      llmDebug: result.llmDebug
    });

    writeStreamEvent(res, { type: "result", payload: result });
  } catch (error) {
    writeStreamEvent(res, {
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    res.end();
  }
}

function handleSessionGet(url: URL, res: ServerResponse): void {
  const sessionId = normalizeSessionId(url.searchParams.get("sessionId") ?? "default");
  const session = getSession(sessionId);
  json(res, 200, {
    ok: true,
    sessionId,
    updatedAt: session.updatedAt,
    turns: session.turns
  });
}

async function handleSessionClear(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(req)) as { sessionId?: string };
  const sessionId = normalizeSessionId(payload.sessionId);
  sessions.set(sessionId, {
    sessionId,
    updatedAt: nowIso(),
    turns: []
  });
  json(res, 200, { ok: true, sessionId });
}

async function serveStatic(res: ServerResponse, relPath: string): Promise<void> {
  const safePath = relPath === "/" ? "/index.html" : relPath;
  if (safePath.includes("..")) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Invalid path");
    return;
  }
  const filePath = join(webRoot, safePath);
  const content = await readFile(filePath);
  res.writeHead(200, { "Content-Type": pickMime(filePath) });
  res.end(content);
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url) {
      json(res, 400, { error: "Invalid request" });
      return;
    }

    const cors = corsHeaders(req.headers.origin);
    for (const [k, v] of Object.entries(cors)) {
      res.setHeader(k, v);
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    if (req.method === "POST" && pathname === "/api/drag") {
      await handleDrag(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/solve") {
      await handleSolve(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/solve/stream") {
      await handleSolveStream(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/patch") {
      await handlePatch(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/replay-dsl") {
      await handleReplayDsl(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/parse-dsl") {
      await handleParseDsl(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/session") {
      handleSessionGet(url, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/session/clear") {
      await handleSessionClear(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, pathname);
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 500, { error: message });
  }
});

const port = Number(process.env.PORT ?? 4310);
server.listen(port, () => {
  console.log(`GeoMCP chat UI running at http://localhost:${port}`);
});
