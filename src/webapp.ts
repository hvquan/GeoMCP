import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGeometryPipeline } from "./pipeline/index.js";

type SolveRequest = {
  sessionId?: string;
  message?: string;
  imageDataUrl?: string;
  solverIterations?: number;
};

type SolveResult = {
  ok: true;
  parserVersion: string;
  recognizedText: string;
  warnings: string[];
  diagnostics: string[];
  svg: string;
  dsl?: unknown;
  dslExpanded?: unknown;
  llmDebug?: { prompt: string; rawResponse: string; model: string };
  pipelineSteps?: Array<{ step: number | string; label: string; data: unknown }>;
  /** GeoRender Canonical IR — for client-side drag interaction */
  canonical?: unknown;
  /** GeoRender scene graph — for client-side drag interaction */
  scene?: unknown;
  /** Free-point seed positions — for client-side drag interaction */
  freePoints?: Record<string, { x: number; y: number }>;
};

type ParseDslResult = {
  ok: true;
  parserVersion: string;
  recognizedText: string;
  warnings: string[];
  dsl: unknown;
  dslExpanded: unknown;
};

type StreamEvent =
  | { type: "progress"; stage: string; message: string }
  | { type: "step"; step: number | string; label: string; data: unknown }
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
  llmDebug?: SolveResult["llmDebug"];
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

  const parserModelRaw = (process.env.GEOMCP_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini").trim();
  const parserModelNormalized = normalizeModelName(parserModelRaw);
  if (parserModelRaw && parserModelRaw !== parserModelNormalized) {
    warnings.push(`Model '${parserModelRaw}' is deprecated; auto-switched to '${parserModelNormalized}'.`);
  }

  stepLog(++n, "INPUT (L1)", { solverIterations, hasImage: !!imageDataUrl, text: (payload.message ?? "").trim() }, collectStep);

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

  onProgress?.("parse", "Parsing geometry with LLM -> DSL (constraint-based)...");
  const pipelineResult = await runGeometryPipeline(recognizedText, {
    parseOnly: false,
  });
  let parserVersion = pipelineResult.parserVersion;
  const { dsl, dslExpanded, llmDebug, rawDslJson } = pipelineResult;
  warnings.push(...pipelineResult.warnings);

  // Emit debug step logs from pipeline intermediates
  if (llmDebug) {
    const parseFailed = pipelineResult.warnings.some(w => w.startsWith("DSL parser fallback"));
    stepLog(++n, `prompt → LLM (L4 few-shots + L5 adapter, model: ${llmDebug.model})`, llmDebug.prompt, collectStep);
    stepLog(++n, parseFailed ? "raw LLM response — parse FAILED (L6 extractor)" : "raw LLM response (L6 extractor)", llmDebug.rawResponse, collectStep);
  }
  if (rawDslJson) stepLog(++n, "LLM raw JSON", rawDslJson, collectStep);
  if (pipelineResult.georenderRawDsl) stepLog(++n, "DSL result", pipelineResult.georenderRawDsl, collectStep);
  if (pipelineResult.georenderCanonical) stepLog(++n, "Canonical result", pipelineResult.georenderCanonical, collectStep);
  if (pipelineResult.scene) stepLog(++n, "Scene graph", pipelineResult.scene, collectStep);

  const svg = pipelineResult.svg;
  const diagnostics: string[] = [];

  // If GeoRender compile/solve failed, still emit the intermediates as steps then throw
  if (pipelineResult.georenderErrors && pipelineResult.georenderErrors.length > 0) {
    onProgress?.("render", "GeoRender error.");
    throw new Error(pipelineResult.georenderErrors[0]);
  }

  onProgress?.("render", "SVG ready.");

  return {
    ok: true,
    parserVersion,
    recognizedText,
    warnings,
    diagnostics,
    svg,
    dsl,
    dslExpanded,
    pipelineSteps,
    llmDebug,
    canonical: pipelineResult.georenderCanonical,
    scene: pipelineResult.scene,
    freePoints: pipelineResult.freePoints,
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

// ─── /api/dsl — DSL Debugger pipeline (returns canonical + scene + svg) ───────

async function handleApiDsl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(req)) as { dsl: unknown };
  const { normalizeRawDsl } = await import("./dsl/normalize.js");
  const { adaptDsl } = await import("./dsl/adapter.js");
  const { runFromCanonical } = await import("./pipeline/run-from-canonical.js");
  const { dsl: raw, warnings: normalizeWarnings } = normalizeRawDsl(payload.dsl);
  const { canonical, freePoints, warnings: adapterWarnings } = adaptDsl(raw);
  const warnings = [
    ...normalizeWarnings.map(w => `[normalize:${w.code}] ${w.message}`),
    ...adapterWarnings,
  ];
  const { scene, svg, errors } = runFromCanonical(canonical, freePoints);
  json(res, 200, { canonical, freePoints, scene, svg, warnings, errors });
}

// ─── /api/canonical — re-render after drag (returns scene + svg) ──────────────

async function handleApiCanonical(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(req)) as {
    ir: unknown;
    freePoints: Record<string, { x: number; y: number }>;
    fixedScale?: number;
    fixedOffX?: number;
    fixedOffY?: number;
  };
  const { runFromCanonical } = await import("./pipeline/run-from-canonical.js");
  const { scene, svg, errors } = runFromCanonical(
    payload.ir as any, payload.freePoints,
    payload.fixedScale, payload.fixedOffX, payload.fixedOffY
  );
  json(res, 200, { scene, svg, errors });
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

    appendSessionTurn(sessionId, {
      timestamp: nowIso(),
      userText,
      recognizedText: result.recognizedText,
      parserVersion: result.parserVersion,
      warnings: result.warnings,
      diagnostics: result.diagnostics,
      svg: result.svg,
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

    if (req.method === "POST" && pathname === "/api/solve/stream") {
      await handleSolveStream(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/dsl") {
      await handleApiDsl(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/canonical") {
      await handleApiCanonical(req, res);
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

    if (req.method === "GET" && (pathname === "/dsl" || pathname === "/dsl/")) {
      await serveStatic(res, "/dsl/dsl.html");
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
