/**
 * Geometry Pipeline
 *
 * Orchestrates the end-to-end geometry solving pipeline:
 *   [L2/3] Language detection + geometry phrase normalization
 *   [L4]   Dynamic prompt building (language-aware few-shots)
 *   [L5-8] LLM parsing → repair → schema validation → normalizeDsl
 *   [L9+]  GeoRender: normalizeRawDsl → adaptDsl → compile → solve → scene → SVG
 *
 * This module is transport-agnostic (no HTTP, no sessions, no streaming).
 * Both the MCP server (src/index.ts) and the web API (src/webapp.ts) can call
 * this as the canonical core pipeline.
 */
import {
  parseGeometryDslWithLLM,
  expandDslMacros
} from "../parsing/index.js";
import type { DslLlmDebug } from "../parsing/dslParser.js";
import { detectAndNormalize } from "../language/index.js";
import { runFromGeomcpDsl } from "./run-from-geomcp-dsl.js";
import type { GeometryDsl } from "../parsing/index.js";
import type { NormalizedGeometryInput } from "../language/canonical-language.js";

export interface GeometryPipelineOptions {
  /** LLM model name override (default: GEOMCP_OPENAI_MODEL env var or gpt-4.1-mini). */
  model?: string;
  /** Constraint-solver iterations (default: 160, clamped to [40, 2000]). */
  solverIterations?: number;
  /**
   * Skip layout and SVG computation — return only the parsed model and
   * intermediate representations (dsl, dslExpanded, llmDebug).
   * When true, `svg` in the result is an empty string.
   */
  parseOnly?: boolean;
}

export interface GeometryPipelineResult {
  parserVersion: string;
  warnings: string[];
  dsl?: GeometryDsl;
  dslExpanded?: GeometryDsl;
  llmDebug?: DslLlmDebug;
  /** Language detection + phrase normalization result from Layer 1/2. */
  normalized?: NormalizedGeometryInput;
  /** Raw LLM JSON before any GeoMCP normalization — fed directly to GeoRender. */
  rawDslJson?: unknown;
  /** GeoRender RawDSL — output of normalizeRawDsl(), step 1 of the GeoRender pipeline. */
  georenderRawDsl?: unknown;
  /** GeoRender Canonical IR — output of adaptDsl(), step 2 of the GeoRender pipeline. */
  georenderCanonical?: unknown;
  /** GeoRender errors from compile/solve phase (empty = success). */
  georenderErrors?: string[];
  /** GeoRender scene graph (after compile+solve). */
  scene?: unknown;
  /** Free-point seed positions from adaptDsl(). */
  freePoints?: Record<string, { x: number; y: number }>;
  svg: string;
}

/**
 * Run the full geometry pipeline for a text problem description.
 * Resolves with a fully-rendered SVG and the intermediate representations.
 */
export async function runGeometryPipeline(
  problemText: string,
  options: GeometryPipelineOptions = {}
): Promise<GeometryPipelineResult> {
  const {
    model: llmModel,
    parseOnly = false
  } = options;

  let parserVersion = "v3-dsl-llm-strict";
  const warnings: string[] = [];
  let dsl: GeometryDsl | undefined;
  let dslExpanded: GeometryDsl | undefined;
  let llmDebug: DslLlmDebug | undefined;
  let rawDslJson: unknown;

  // [L2/3] Language detection + geometry phrase normalization
  const normalized = detectAndNormalize(problemText);

  try {
    const result = await parseGeometryDslWithLLM(problemText, { model: llmModel, normalized });
    if ((result as any)._llmDebug) {
      llmDebug = (result as any)._llmDebug as DslLlmDebug;
      delete (result as any)._llmDebug;
    }
    dsl = result;
    dslExpanded = expandDslMacros(dsl);
    rawDslJson = llmDebug?.rawJson;
  } catch (err) {
    throw err;
  }

  if (parseOnly) {
    return { parserVersion, warnings, dsl, dslExpanded, llmDebug, normalized, rawDslJson, svg: "" };
  }

  // [GeoRender] normalizeRawDsl → adaptDsl → compile → solve → scene → SVG
  const georenderInput = rawDslJson ?? dsl;
  if (!georenderInput) {
    return { parserVersion, warnings, dsl, dslExpanded, llmDebug, normalized, rawDslJson, svg: "" };
  }
  const { svg, scene, freePoints, rawDsl: georenderRawDsl, canonical: georenderCanonical, warnings: grWarnings, errors } = runFromGeomcpDsl(georenderInput);
  warnings.push(...grWarnings);
  if (errors.length > 0) {
    // Attach errors so callers can detect pipeline failure while still accessing intermediates
    warnings.push(...errors.map(e => `GeoRender error: ${e}`));
  }

  return { parserVersion, warnings, dsl, dslExpanded, llmDebug, normalized, rawDslJson, georenderRawDsl, georenderCanonical, georenderErrors: errors, scene, freePoints, svg };
}
