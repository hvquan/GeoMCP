import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGeometryProblem } from "./parser.js";
import { parseGeometryProblemWithLLM } from "./llmParser.js";
import { buildLayout } from "./layout.js";
import { enrichModelForV2 } from "./v2Model.js";
import { refineLayoutWithSolver } from "./solver.js";
import { renderSvg } from "./svg.js";
import type { GeometryModel, LayoutModel, Point } from "./types.js";

type SolveRequest = {
  sessionId?: string;
  message?: string;
  imageDataUrl?: string;
  parserMode?: "heuristic" | "llm" | "llm-strict";
  solverIterations?: number;
};

type SolveResult = {
  ok: true;
  parserVersion: string;
  recognizedText: string;
  warnings: string[];
  diagnostics: string[];
  svg: string;
  parsed: {
    points: string[];
    circles: GeometryModel["circles"];
    triangles: GeometryModel["triangles"];
    midpoints: GeometryModel["midpoints"];
    pointsOnSegments: GeometryModel["pointsOnSegments"];
    altitudes: GeometryModel["altitudes"];
    medians: GeometryModel["medians"];
    angleBisectors: GeometryModel["angleBisectors"];
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
    lineEntities: Array<{ id: string; a: string; b: string }>;
    circleEntities: Array<{ id: string; center: string; radius?: number }>;
    parallelsWithIds: Array<{ line1Id: string; line2Id: string }>;
    perpendicularsWithIds: Array<{ line1Id: string; line2Id: string }>;
    tangentIntersectionsWithIds: Array<{ at: string; circleId?: string; withLineId: string; intersection: string }>;
    namedTangentsWithIds: Array<{ at: string; circleId?: string; linePoint: string }>;
  };
};

type StreamEvent =
  | { type: "progress"; stage: string; message: string }
  | { type: "result"; payload: SolveResult }
  | { type: "error"; message: string };

type SessionTurn = {
  timestamp: string;
  userText: string;
  recognizedText: string;
  parserVersion: string;
  warnings: string[];
  diagnostics: string[];
  svg: string;
};

type SessionData = {
  sessionId: string;
  updatedAt: string;
  turns: SessionTurn[];
};

type ChatMessage = {
  role: "system" | "user";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

const __filename = fileURLToPath(import.meta.url);
const projectRoot = join(__filename, "../../..");
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

function getOpenAIConfig(): { apiKey: string; model: string; baseUrl: string } {
  const apiKey = process.env.GEOMCP_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("Missing API key. Set GEOMCP_OPENAI_API_KEY or OPENAI_API_KEY.");
  }

  const model = normalizeModelName(process.env.GEOMCP_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini");
  const baseUrl = (process.env.GEOMCP_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
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

function scoreLayout(model: GeometryModel, layout: LayoutModel): number {
  const byId = new Map(layout.points.map((p) => [p.id, p]));
  const circleCenterById = new Map(
    layout.circles.filter((c) => c.id).map((c) => [c.id as string, c.center])
  );
  let score = 0;

  for (const c of model.circlesByDiameter) {
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    const center = byId.get(c.centerId ?? "O");
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

  for (const nt of model.namedTangents) {
    const at = byId.get(nt.at);
    const centerKey =
      (nt.circleId && circleCenterById.get(nt.circleId)) || nt.center || model.circlesByDiameter[0]?.centerId || "O";
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
  for (const a of model.altitudes) add(a.baseA, a.baseB);
  for (const m of model.medians) add(m.baseA, m.baseB);
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
  for (const c of model.circlesByDiameter) centers.add(c.centerId ?? "O");
  for (const p of model.pointsOnCircles) centers.add(p.center);
  for (const cc of model.circleConstraints) centers.add(cc.centerPointId);
  for (const dc of model.diameterConstraints) centers.add(dc.circleId.replace(/^c_/, ""));
  for (const n of model.namedTangents) if (n.center) centers.add(n.center);
  for (const t of model.tangentIntersections) if (t.center) centers.add(t.center);

  const radiusByCenter = new Map<string, number>();
  for (const c of layout.circles) {
    if (!radiusByCenter.has(c.center)) {
      radiusByCenter.set(c.center, c.radius);
    }
  }

  const sortedCenters = [...centers].sort();
  const circleIdByCenter = new Map<string, string>();
  const circleEntities = sortedCenters.map((center, idx) => {
    const id = `C${idx + 1}`;
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
    return fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`
      },
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

async function solveGeometry(
  payload: SolveRequest,
  onProgress?: (stage: string, message: string) => void
): Promise<SolveResult> {
  const message = (payload.message ?? "").trim();
  const imageDataUrl = (payload.imageDataUrl ?? "").trim();
  const parserMode = payload.parserMode ?? "heuristic";
  const solverIterations = Math.max(40, Math.min(1200, payload.solverIterations ?? 180));

  if (!message && !imageDataUrl) {
    throw new Error("Please provide text or an image.");
  }

  const warnings: string[] = [];
  let recognizedText = message;

  if (parserMode === "llm" || parserMode === "llm-strict") {
    const parserModelRaw = (process.env.GEOMCP_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini").trim();
    const parserModelNormalized = normalizeModelName(parserModelRaw);
    if (parserModelRaw && parserModelRaw !== parserModelNormalized) {
      warnings.push(`Model '${parserModelRaw}' is deprecated; auto-switched to '${parserModelNormalized}'.`);
    }
  }

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
  }

  if (recognizedText && imageDataUrl) {
    warnings.push("Image attached: using the typed text as primary input.");
  }

  let parsed;
  let parserVersion = "v1-heuristic";

  onProgress?.(
    "parse",
    parserMode === "heuristic"
      ? "Parsing geometry with heuristic parser..."
      : "Parsing geometry with LLM JSON schema..."
  );
  if (parserMode === "llm" || parserMode === "llm-strict") {
    try {
      parsed = await parseGeometryProblemWithLLM(recognizedText);
      parserVersion = parserMode === "llm-strict" ? "v2-llm-strict" : "v2-llm";
    } catch (err) {
      if (parserMode === "llm-strict") {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const hint = /\b429\b|quota|RESOURCE_EXHAUSTED/i.test(message)
        ? "LLM parser fallback to heuristic: LLM quota exceeded (429)."
        : `LLM parser fallback to heuristic: ${message}`;
      warnings.push(hint);
      parsed = parseGeometryProblem(recognizedText);
      parserVersion = "v2-fallback-v1";
    }
  } else {
    parsed = parseGeometryProblem(recognizedText);
  }

  onProgress?.("solve", "Applying relation enrichment and constraint solver...");
  const enriched = enrichModelForV2(parsed);
  const baseLayout = buildLayout(enriched);
  const refinedLayout = refineLayoutWithSolver(enriched, baseLayout, { iterations: solverIterations });

  // Keep the solution that better satisfies geometric constraints.
  const baseScore = scoreLayout(enriched, baseLayout);
  const refinedScore = scoreLayout(enriched, refinedLayout);
  const layout = refinedScore <= baseScore ? refinedLayout : baseLayout;
  if (refinedScore > baseScore) {
    warnings.push("Solver refinement skipped: base layout satisfies constraints better.");
  }
  warnings.push(`Constraint score (base=${baseScore.toFixed(3)}, refined=${refinedScore.toFixed(3)}).`);

  onProgress?.("render", "Rendering SVG diagram...");
  const svg = renderSvg(layout);

  const { lineEntities, lineIdByKey } = buildLineEntities(enriched);
  const { circleEntities, circleIdByCenter } = buildCircleEntities(enriched, layout);

  return {
    ok: true,
    parserVersion,
    recognizedText,
    warnings,
    diagnostics: layout.diagnostics,
    svg,
    parsed: {
      points: enriched.points,
      circles: enriched.circles,
      triangles: enriched.triangles,
      midpoints: enriched.midpoints,
      pointsOnSegments: enriched.pointsOnSegments,
      altitudes: enriched.altitudes,
      medians: enriched.medians,
      angleBisectors: enriched.angleBisectors,
      parallels: enriched.parallels,
      circlesByDiameter: enriched.circlesByDiameter,
      pointsOnCircles: enriched.pointsOnCircles,
      circleConstraints: enriched.circleConstraints,
      diameterConstraints: enriched.diameterConstraints,
      perpendiculars: enriched.perpendiculars,
      namedTangents: enriched.namedTangents,
      lines: enriched.lines,
      lineIntersections: enriched.lineIntersections,
      perpendicularLines: enriched.perpendicularLines,
      perpendicularThroughPointIntersections: enriched.perpendicularThroughPointIntersections,
      tangents: enriched.tangents,
      tangentIntersections: enriched.tangentIntersections,
      lineEntities,
      circleEntities,
      parallelsWithIds: enriched.parallels.map((p) => ({
        line1Id: lineIdByKey.get(lineKey(p.line1.a, p.line1.b)) ?? "",
        line2Id: lineIdByKey.get(lineKey(p.line2.a, p.line2.b)) ?? ""
      })),
      perpendicularsWithIds: enriched.perpendiculars.map((p) => ({
        line1Id: lineIdByKey.get(lineKey(p.line1.a, p.line1.b)) ?? "",
        line2Id: lineIdByKey.get(lineKey(p.line2.a, p.line2.b)) ?? ""
      })),
      tangentIntersectionsWithIds: enriched.tangentIntersections.map((t) => ({
        at: t.at,
        circleId: t.center ? circleIdByCenter.get(t.center) : circleIdByCenter.get(enriched.circlesByDiameter[0]?.centerId ?? "O"),
        withLineId: lineIdByKey.get(lineKey(t.withLine.a, t.withLine.b)) ?? "",
        intersection: t.intersection
      })),
      namedTangentsWithIds: enriched.namedTangents.map((n) => ({
        at: n.at,
        circleId: n.center ? circleIdByCenter.get(n.center) : circleIdByCenter.get(enriched.circlesByDiameter[0]?.centerId ?? "O"),
        linePoint: n.linePoint
      }))
    }
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

async function handleSolve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(req)) as SolveRequest;
  const sessionId = normalizeSessionId(payload.sessionId);
  const userText = (payload.message ?? "").trim() || "[image upload]";
  const result = await solveGeometry(payload);

  appendSessionTurn(sessionId, {
    timestamp: nowIso(),
    userText,
    recognizedText: result.recognizedText,
    parserVersion: result.parserVersion,
    warnings: result.warnings,
    diagnostics: result.diagnostics,
    svg: result.svg
  });

  json(res, 200, result);
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
    const result = await solveGeometry(payload, (stage, message) => {
      writeStreamEvent(res, { type: "progress", stage, message });
    });

    appendSessionTurn(sessionId, {
      timestamp: nowIso(),
      userText,
      recognizedText: result.recognizedText,
      parserVersion: result.parserVersion,
      warnings: result.warnings,
      diagnostics: result.diagnostics,
      svg: result.svg
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

    if (req.method === "POST" && pathname === "/api/solve") {
      await handleSolve(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/solve/stream") {
      await handleSolveStream(req, res);
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
