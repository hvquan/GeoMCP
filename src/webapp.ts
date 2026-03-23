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

type SolveRequest = {
  message?: string;
  imageDataUrl?: string;
  parserMode?: "heuristic" | "llm";
  solverIterations?: number;
};

type ChatMessage = {
  role: "system" | "user";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

const __filename = fileURLToPath(import.meta.url);
const projectRoot = join(__filename, "../../..");
const webRoot = join(projectRoot, "web");

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
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

function getOpenAIConfig(): { apiKey: string; model: string; baseUrl: string } {
  const apiKey = process.env.GEOMCP_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("Missing API key. Set GEOMCP_OPENAI_API_KEY or OPENAI_API_KEY.");
  }

  const model = process.env.GEOMCP_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
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

async function callOpenAIChat(messages: ChatMessage[], model?: string): Promise<string> {
  const cfg = getOpenAIConfig();
  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify({
      model: model ?? cfg.model,
      temperature: 0,
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text}`);
  }

  return parseCompletionText(await response.json());
}

async function extractTextFromImage(imageDataUrl: string): Promise<string> {
  const visionModel = process.env.GEOMCP_VISION_MODEL ?? process.env.GEOMCP_OPENAI_MODEL ?? "gpt-4.1-mini";
  const text = await callOpenAIChat(
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

  return text.trim();
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
  const message = (payload.message ?? "").trim();
  const imageDataUrl = (payload.imageDataUrl ?? "").trim();
  const parserMode = payload.parserMode ?? "llm";
  const solverIterations = Math.max(40, Math.min(1200, payload.solverIterations ?? 180));

  if (!message && !imageDataUrl) {
    json(res, 400, { error: "Please provide text or an image." });
    return;
  }

  const warnings: string[] = [];
  let recognizedText = message;

  if (!recognizedText && imageDataUrl) {
    recognizedText = await extractTextFromImage(imageDataUrl);
    if (!recognizedText) {
      throw new Error("Could not extract readable text from the image.");
    }
  }

  if (recognizedText && imageDataUrl) {
    warnings.push("Image attached: using the typed text as primary input.");
  }

  let parsed;
  let parserVersion = "v1-heuristic";

  if (parserMode === "llm") {
    try {
      parsed = await parseGeometryProblemWithLLM(recognizedText);
      parserVersion = "v2-llm";
    } catch (err) {
      warnings.push(`LLM parser fallback to heuristic: ${err instanceof Error ? err.message : String(err)}`);
      parsed = parseGeometryProblem(recognizedText);
      parserVersion = "v2-fallback-v1";
    }
  } else {
    parsed = parseGeometryProblem(recognizedText);
  }

  const enriched = enrichModelForV2(parsed);
  const baseLayout = buildLayout(enriched);
  const layout = refineLayoutWithSolver(enriched, baseLayout, { iterations: solverIterations });
  const svg = renderSvg(layout);

  json(res, 200, {
    ok: true,
    parserVersion,
    recognizedText,
    warnings,
    diagnostics: layout.diagnostics,
    svg,
    parsed: {
      points: enriched.points,
      triangles: enriched.triangles,
      circlesByDiameter: enriched.circlesByDiameter,
      pointsOnCircles: enriched.pointsOnCircles,
      perpendiculars: enriched.perpendiculars,
      tangents: enriched.tangents,
      tangentIntersections: enriched.tangentIntersections
    }
  });
}

async function serveStatic(res: ServerResponse, relPath: string): Promise<void> {
  const safePath = relPath === "/" ? "/index.html" : relPath;
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

    if (req.method === "POST" && req.url === "/api/solve") {
      await handleSolve(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, req.url);
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
