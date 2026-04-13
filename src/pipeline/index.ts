/**
 * Geometry Pipeline
 *
 * Orchestrates the end-to-end geometry solving pipeline:
 *   [L2/3] Language detection + geometry phrase normalization
 *   [L4]   Dynamic prompt building (language-aware few-shots)
 *   [L5-8] LLM parsing → repair → schema validation → normalizeDsl
 *   [L9]   dslToCanonical
 *   [L10-11] canonicalToGeometryModel + desugaring
 *   [L12-13] buildLayout → refineLayoutWithSolver
 *   [L14]  renderSvg
 *
 * This module is transport-agnostic (no HTTP, no sessions, no streaming).
 * Both the MCP server (src/index.ts) and the web API (src/webapp.ts) can call
 * this as the canonical core pipeline.
 */
import {
  parseGeometryDslWithLLM,
  parseGeometryProblem,
  canonicalToGeometryModel,
  expandDslMacros,
  parseGeometryProblemWithLLM
} from "../parsing/index.js";
import { dslToCanonical } from "../dsl/index.js";
import { buildLayout, refineLayoutWithSolver, renderSvg } from "../geometry/index.js";
import { detectAndNormalize } from "../language/index.js";
import type { GeometryModel } from "../model/types.js";
import type { CanonicalProblem } from "../dsl/index.js";
import type { LayoutModel } from "../geometry/index.js";
import type { GeometryDsl } from "../parsing/index.js";
import type { NormalizedGeometryInput } from "../language/canonical-language.js";

export interface GeometryPipelineOptions {
  /** Parser mode (default: "dsl-llm"). */
  parserMode?: "heuristic" | "dsl-llm" | "dsl-llm-strict" | "llm" | "llm-strict";
  /** LLM model name override (default: GEOMCP_OPENAI_MODEL env var or gpt-4.1-mini). */
  model?: string;
  /** Constraint-solver iterations (default: 160, clamped to [40, 2000]). */
  solverIterations?: number;
  /** Fall back to heuristic parser if LLM fails (default: true). */
  fallbackToHeuristic?: boolean;
  /** Run the constraint solver after initial layout (default: true). */
  useConstraintSolver?: boolean;
  /**
   * Skip layout and SVG computation — return only the parsed model and
   * intermediate representations (dsl, dslExpanded, llmDebug).
   * When true, `layout` and `svg` in the result are empty placeholders.
   */
  parseOnly?: boolean;
}

export interface GeometryPipelineResult {
  parserVersion: string;
  warnings: string[];
  parsed: GeometryModel;
  canonical?: CanonicalProblem;
  dsl?: GeometryDsl;
  dslExpanded?: GeometryDsl;
  llmDebug?: { prompt: string; rawResponse: string; model: string };
  /** Language detection + phrase normalization result from Layer 1/2. */
  normalized?: NormalizedGeometryInput;
  layout: LayoutModel;
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
    parserMode = "dsl-llm",
    model: llmModel,
    solverIterations = 160,
    fallbackToHeuristic = true,
    useConstraintSolver = true,
    parseOnly = false
  } = options;

  const clampedIterations = Math.max(40, Math.min(2000, solverIterations));

  let parsed: GeometryModel | undefined;
  let parserVersion = "v1-heuristic";
  const warnings: string[] = [];
  let canonical: CanonicalProblem | undefined;
  let dsl: GeometryDsl | undefined;
  let dslExpanded: GeometryDsl | undefined;
  let llmDebug: { prompt: string; rawResponse: string; model: string } | undefined;

  // [L2/3] Language detection + geometry phrase normalization
  const normalized = detectAndNormalize(problemText);

  if (parserMode === "dsl-llm" || parserMode === "dsl-llm-strict") {
    try {
      dsl = await parseGeometryDslWithLLM(problemText, { model: llmModel, normalized });
      if ((dsl as any)._llmDebug) {
        llmDebug = (dsl as any)._llmDebug;
        delete (dsl as any)._llmDebug;
      }
      dslExpanded = expandDslMacros(dsl);
      canonical = dslToCanonical(dsl);
      parsed = canonicalToGeometryModel(canonical, problemText);
      parserVersion = parserMode === "dsl-llm-strict" ? "v3-dsl-llm-strict" : "v3-dsl-llm";
    } catch (err) {
      if (parserMode === "dsl-llm-strict" || !fallbackToHeuristic) {
        throw err;
      }
      const errDebug = (err as any)._llmDebug;
      if (errDebug) llmDebug = errDebug;
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`DSL parser fallback to LLM JSON parser: ${message}`);
      try {
        parsed = await parseGeometryProblemWithLLM(problemText, { model: llmModel });
        parserVersion = "v3-dsl-fallback-v2-llm";
      } catch (innerErr) {
        const innerMessage = innerErr instanceof Error ? innerErr.message : String(innerErr);
        warnings.push(`LLM JSON fallback to heuristic: ${innerMessage}`);
        parsed = parseGeometryProblem(problemText);
        parserVersion = "v3-dsl-fallback-v1";
      }
    }
  } else if (parserMode === "llm" || parserMode === "llm-strict") {
    try {
      parsed = await parseGeometryProblemWithLLM(problemText, { model: llmModel });
      parserVersion = parserMode === "llm-strict" ? "v2-llm-strict" : "v2-llm";
    } catch (err) {
      if (parserMode === "llm-strict" || !fallbackToHeuristic) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const hint = /\b429\b|quota|RESOURCE_EXHAUSTED/i.test(message)
        ? "LLM parser fallback to heuristic: LLM quota exceeded (429)."
        : `LLM parser fallback to heuristic: ${message}`;
      warnings.push(hint);
      parsed = parseGeometryProblem(problemText);
      parserVersion = "v2-fallback-v1";
    }
  } else {
    parsed = parseGeometryProblem(problemText);
    parserVersion = "v1-heuristic";
  }

  if (parseOnly) {
    const emptyLayout: LayoutModel = { points: [], segments: [], circles: [], nodes: [], diagnostics: [] };
    return { parserVersion, warnings, parsed: parsed!, canonical, dsl, dslExpanded, llmDebug, normalized, layout: emptyLayout, svg: "" };
  }

  const baseLayout = buildLayout(parsed!);
  const layout = useConstraintSolver
    ? refineLayoutWithSolver(parsed!, baseLayout, { iterations: clampedIterations })
    : baseLayout;
  const svg = renderSvg(layout);

  return { parserVersion, warnings, parsed: parsed!, canonical, dsl, dslExpanded, llmDebug, normalized, layout, svg };
}
