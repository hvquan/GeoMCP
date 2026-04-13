# Module API Reference

## Overview

This document lists the public exports of each module. Internal functions are noted where they matter for understanding the module.

All modules use `.js` extensions in imports (TypeScript ESM with `"moduleResolution": "node16"`).

---

## `src/ai/` — LLM Integration

### `ai/prompt-builder.ts` — Layer 4

```typescript
// Static prompt (English-only few-shots)
export function buildGeometrySystemPrompt(): string
export const GEOMETRY_SYSTEM_PROMPT: string   // pre-built at module load time

// Dynamic prompt — language-adapted, used in production
export function buildDynamicGeometrySystemPrompt(
  normalized: NormalizedGeometryInput
): string
// Calls selectFewShots(language, canonicalPhrases) and inserts
// language-matched examples into the prompt header.

export const PROMPT_HEADER: string  // shared header used by both builders
```

`GEOMETRY_SYSTEM_PROMPT` encodes:
- All allowed object/constraint/construction/target types
- Rules for tangent lines, on_circle points, inscribed triangles, etc.
- 3 fixed English few-shot examples (fallback)

`buildDynamicGeometrySystemPrompt` replaces the static few-shots with up to 3
language-matched examples selected by `selectFewShots`. Used by all production paths.

**Source of truth**: This file. Do not edit `resources/prompts/system-prompt.txt` instead.

---

### `ai/repair.ts` — Layer 7

```typescript
export function repairDslJson(raw: unknown): unknown
// 6 structural fixes applied BEFORE Zod schema validation:
//   1. Unwrap accidental outer wrapper keys (result, data, output, …)
//   2. Convert objects-as-map to array
//   3. Default missing constraints / objects to []
//   4. Coerce string-typed numbers ("radius": "5" → 5)
//   5. Uppercase point names ("a" → "A")
//   6. Fix common type aliases ("circle_object" → "circle")

export function buildRepairPrompt(
  rawResponse: string,
  error: string
): string
// Builds a second-turn LLM prompt for semantic repair:
// includes the original raw response + Zod error message.
// Used by parseGeometryDslWithLLM for retry on schema failure.
```

---

### `ai/llm-adapter.ts`

```typescript
export interface LlmCallOptions { model?: string }
export interface LlmApiConfig { apiKey: string; model: string; baseUrl: string }
export interface LlmResponse  { text: string; model: string }

export function getApiConfig(options: LlmCallOptions): LlmApiConfig
export async function callLlm(
  systemPrompt: string,
  userPrompt: string,
  options?: LlmCallOptions
): Promise<LlmResponse>
```

Config resolution order:
1. `options.model` → `GEOMCP_OPENAI_MODEL` → `OPENAI_MODEL` → `"gpt-4.1-mini"`
2. `GEOMCP_OPENAI_BASE_URL` → `OPENAI_BASE_URL` → `"https://api.openai.com/v1"`
3. `GEOMCP_OPENAI_API_KEY` → `OPENAI_API_KEY` (skipped for local base URLs)

Local detection regex: `https?://(localhost|127.0.0.1|0.0.0.0)(:\d+)?`

---

### `ai/output-extractor.ts` — Layer 6

```typescript
export function extractJsonObject(text: string): unknown
```

Finds the first `{...}` block in an LLM response string.  
Throws if no valid JSON object is found.

---

## `src/language/` — Multilingual Normalization (Layers 2–4)

### `language/canonical-language.ts` — shared types

```typescript
export type DetectedLanguage = "vi" | "en" | "sv" | "unknown"

export interface CanonicalPhrase {
  type: string         // e.g. "diameter", "tangent", "point_on_circle"
  surfaceForm: string  // original text fragment that matched
  language: DetectedLanguage
}

export interface NormalizedGeometryInput {
  language: DetectedLanguage
  canonicalPhrases: CanonicalPhrase[]
  normalizedText?: string
}
```

---

### `language/detect.ts` — Layer 2

```typescript
export function detectLanguage(text: string): DetectedLanguage
```

Rule-based: Vietnamese detected by Unicode diacritics, Swedish by characteristic words ("cirkel", "vinkelrät", etc.), falls back to `"en"`.

---

### `language/term-lexicon.ts`

```typescript
export const GEOMETRY_TERM_LEXICON: Record<DetectedLanguage, Record<string, string>>
```

20-entry VI/EN/SV geometry glossary mapping surface terms to canonical English equivalents.

---

### `language/normalize-phrases.ts` — Layer 3

```typescript
export function detectCanonicalPhrases(
  text: string,
  language: DetectedLanguage
): CanonicalPhrase[]
```

Scans `text` for geometry phrase patterns per language using a regex lexicon. Returns an array of `CanonicalPhrase` objects with their `type` (e.g. `"diameter"`) and `surfaceForm`.

---

### `language/fewshot-selector.ts` — Layer 4

```typescript
export interface FewShotExample {
  language: DetectedLanguage
  topics: string[]
  problem: string
  dsl: object
}

export function selectFewShots(
  language: DetectedLanguage,
  phrases: CanonicalPhrase[],
  maxExamples?: number   // default: 3
): FewShotExample[]
```

Scores the built-in example bank (8 examples: 3 VI, 3 EN, 2 SV) by language match + topic overlap. Returns up to `maxExamples` best-scoring examples.

---

### `language/index.ts` — integration point

```typescript
export function detectAndNormalize(text: string): NormalizedGeometryInput
```

Combines `detectLanguage` + `detectCanonicalPhrases` into a single call. This is what `pipeline/index.ts` calls at the start of `runGeometryPipeline`.

---

## `src/parsing/` — Text Parsing (Layer 9)

### `parsing/dslParser.ts` — Layer 9 (orchestrator, Layers 2–9)

```typescript
type DslParseOptions = LlmCallOptions & { normalized?: NormalizedGeometryInput }

export async function parseGeometryDslWithLLM(
  problemText: string,
  options?: DslParseOptions
): Promise<GeometryDsl>
```

Orchestrates the full L2–L9 pipeline: calls `detectAndNormalize` (if not supplied via `options.normalized`), builds dynamic prompt, calls LLM, extracts + repairs + validates JSON, normalizes DSL.  
When `options.normalized` is provided (from `pipeline/index.ts`), uses pre-computed language context.

---

### `parsing/llmParser.ts` — Legacy LLM parser

```typescript
export async function parseGeometryProblemWithLLM(
  problemText: string,
  options?: { model?: string }
): Promise<GeometryModel>
```

Older parser that produces a `GeometryModel` directly (bypasses the DSL layer).  
Still used by `src/index.ts` for the `read_and_draw_geometry_v2_llm` tool.

---

### `parsing/parser.ts` — v1 heuristic

```typescript
export function parseGeometryProblem(problemText: string): GeometryModel
```

Regex-based parser for Vietnamese/English geometry problems.  
Used by the `read_and_draw_geometry` tool and as fallback in v2.

---

### `parsing/index.ts` — barrel

```typescript
export { parseGeometryProblem }          // from ./parser.js
export { parseGeometryProblemWithLLM }   // from ./llmParser.js
export { parseGeometryDslWithLLM }       // from ./dslParser.js
export type { GeometryDsl }
```

---

## `src/dsl/` — DSL Validation & Canonical Representation

### `dsl/dsl.ts` — GeometryDsl types

```typescript
// Top-level DSL type
export type GeometryDsl = {
  objects: DslObject[]
  constraints: DslConstraint[]
  constructions: DslConstruction[]
  targets: DslTarget[]
}

export type DslObject       // 30+ variants: point, line, circle, segment, triangle, …
export type DslConstraint   // 14 variants: on_circle, tangent, perpendicular,
                            //   parallel, midpoint, diameter, foot_of_perpendicular, …
export type DslConstruction // 5 variants: intersection, altitude, median, …
export type DslTarget       // 7 variants: draw_segment, label_point, …

// Macro expansion (L11 pre-canonical)
export function expandDslMacros(dsl: GeometryDsl): GeometryDsl
// Expands shorthand shapes (right_triangle, isosceles_triangle, …)
// into primitive objects + constraints before canonical compilation.

// Low-level helpers used by compiler
export function asPointId(raw: string): string
export function parseLineRef(name: string): LineRef | null
export function parseSegmentName(name: string): [string, string] | null
export function toSegmentPair(a: string, b: string): [string, string]
export function toLineRef(name: string): LineRef

// Re-exports compiler paths (for legacy callers)
export { dslToGeometryModel, canonicalToGeometryModel } from '../runtime/compiler.js'
```

```typescript
export const dslSchema: z.ZodObject<...>
export type DslSchemaOutput = z.infer<typeof dslSchema>

// Helper sub-schemas (also exported):
export const pointSchema        // z.string().regex(/^[A-Z]$/)
export const pointPairSchema    // z.tuple([pointSchema, pointSchema])
export const pointTripleSchema
export const pointQuadSchema
export const lineValueSchema    // string | pointPair
```

`dslSchema.parse(rawJson)` coerces missing `objects`/`constraints`/`constructions`/`targets` to `[]`.

---

### `dsl/canonical.ts` — Canonical Problem (Layer 10)

```typescript
// Entity metadata types
export type EntityOrigin = "explicit" | "derived" | "implicit"
export type EntitySource =
  | "problem_text" | "llm_extraction"
  | "line_through_points" | "intersection_of_lines"
  | "foot_of_perpendicular" | "tangent_at_point"
  | "perpendicular_through_point" | "parallel_through_point"
  | "compiled_from_circle_definition"
  | "layout_helper" | "render_clip" | "label_anchor"

export interface EntityMeta {
  id: string
  label: string | null
  kind: "point"|"circle"|"line"|"segment"|"ray"|"triangle"|"polygon"
       |"radius_parameter"|"angle_parameter"
  origin: EntityOrigin
  source: EntitySource
  visible: boolean
  selectable?: boolean
  debug_name?: string
  roles?: string[]
  construction?: Record<string, string>  // provenance of derived objects
}

// Full entity union (EntityMeta + kind-specific fields)
export type CanonicalEntity =
  | (EntityMeta & { kind: "point" })
  | (EntityMeta & { kind: "circle"; center: string; radius_ref: string })
  | (EntityMeta & { kind: "line"; through?: [string, string] })
  | (EntityMeta & { kind: "segment"; endpoints: [string, string] })
  | (EntityMeta & { kind: "ray"; from: string; direction: string })
  | (EntityMeta & { kind: "triangle"; vertices: [string, string, string] })
  | (EntityMeta & { kind: "polygon"; vertices: string[] })
  | (EntityMeta & { kind: "radius_parameter"; circle: string; value: number|null; interactive: boolean })
  | (EntityMeta & { kind: "angle_parameter"; point: string; circle: string; value: number|null; interactive: boolean })

export interface CanonicalProblem {
  entities: Map<string, CanonicalEntity>
  givens:   CanonicalGiven[]
  goals:    CanonicalGoal[]
}

export function dslToCanonical(dsl: GeometryDsl): CanonicalProblem
```

**ID conventions** generated by this layer:

| Object | ID pattern | Notes |
|---|---|---|
| Named point | `pt_A` | |
| Implicit point | `pt_i_001` | counter-based |
| Circle | `cir_O` | center label |
| Radius param | `rad_cir_O` | auto-created by `ensureCircle` |
| Angle param | `ang_E_on_cir_O` | created by `ensureAngleParam` |
| Line (2 pts) | `ln_CE` | endpoints sorted A–Z |
| Tangent line | `ln_tan_C_on_cir_O` | |
| Perp line | `ln_perp_O_to_ln_CE` | |
| Segment | `seg_EH` | endpoints sorted |
| Ray | `ray_A_B` | NOT sorted — direction preserved |

**Status**: tsc-clean. Wired into the main MCP v2 flow via `pipeline/index.ts` → `runGeometryPipeline`.

---

### `dsl/canonicalizer.ts`

```typescript
export function displayLabel(id: string): string
// "point:O" → "O",  "circle:O" → "O",  plain "O" → "O"

export function normalizeModelIds(model: GeometryModel): GeometryModel
// Prefixes all IDs: points → "point:X", circles → "circle:X", lines → "line:X"
// Called after enrichModelForV2 inside the compiler pipeline.
```

---

### `dsl/index.ts` — barrel

```typescript
export { dslToCanonical }
export type { CanonicalProblem, CanonicalEntity, CanonicalGiven, CanonicalGoal,
              EntityMeta, EntityOrigin, EntitySource }
export { displayLabel, normalizeModelIds }
export { dslSchema }
export type { DslSchemaOutput }
```

---

### `dsl/schema.ts` — Zod validation (Layer 8)

```typescript
export const dslSchema: z.ZodObject<...>
export type DslSchemaOutput = z.infer<typeof dslSchema>

// Helper sub-schemas (also exported):
export const pointSchema        // z.string().regex(/^[A-Z]$/)
export const pointPairSchema    // z.tuple([pointSchema, pointSchema])
export const pointTripleSchema
export const pointQuadSchema
export const lineValueSchema    // string | pointPair
```

`dslSchema.parse(rawJson)` coerces missing `objects`/`constraints`/`constructions`/`targets` to `[]`.

---

## `src/runtime/` — Runtime Geometry Graph (Layers 11–12)

### `runtime/compiler.ts` — Layer 12

```typescript
export { type GeometryDsl }  // re-export for callers

export function canonicalToGeometryModel(
  canonical: CanonicalProblem,
  rawText: string
): GeometryModel

export function dslToGeometryModel(dsl: GeometryDsl, rawText: string): GeometryModel
```

`canonicalToGeometryModel` is the active path. Internally calls `enrichModelForV2` and `normalizeModelIds` before returning.  
`dslToGeometryModel` is the legacy path retained for test scripts.

---

### `runtime/enrichment.ts` — Layer 11 (post-canonical)

```typescript
export function enrichModelForV2(model: GeometryModel): GeometryModel
```

Expands high-level constraints into primitives:
- altitude → `pointsOnSegments` + `perpendiculars`
- median → `midpoints` + `pointsOnSegments`
- angleBisector → `equalAngles` + `pointsOnSegments`
- named tangent → `namedTangents` + `pointsOnCircles`
- incircle / circumcircle → derived circle + constraints

Also deduplicates all constraint lists by structural key.

---

## `src/pipeline/` — End-to-end Orchestration

### `pipeline/index.ts` — Layers 2–16

```typescript
export interface GeometryPipelineOptions {
  model?: string
  fallbackToHeuristic?: boolean   // default: true
  useConstraintSolver?: boolean   // default: true
  solverIterations?: number       // default: 160
  parserMode?: "heuristic" | "dsl-llm" | "dsl-llm-strict" | "llm" | "llm-strict"
  parseOnly?: boolean             // stop after parsing, skip geometry solve
}

export interface GeometryPipelineResult {
  svg?: string
  layout?: LayoutModel
  parsed?: GeometryModel          // from heuristic path
  dsl?: GeometryDsl
  dslExpanded?: GeometryDsl
  canonical?: CanonicalProblem
  normalized?: NormalizedGeometryInput
  parserVersion: string           // e.g. "v3-dsl", "v3-dsl-fallback-v1"
  llmDebug?: { prompt: string; rawResponse: string; model: string }
}

export async function runGeometryPipeline(
  problemText: string,
  options?: GeometryPipelineOptions
): Promise<GeometryPipelineResult>
```

Single wiring point for L2–16. Called by both `src/index.ts` (MCP) and `src/webapp.ts` (HTTP). Never instantiates LLM client or reads config directly — delegates to `ai/`, `language/`, `parsing/`, `runtime/`, `layout/`, `render/`.

---

## `src/model/` — Data Types

### `model/types.ts`

Core interfaces (selected):

```typescript
interface GeometryModel {
  rawText: string
  points: string[]                   // point IDs (normalized: "point:A")
  segments: Segment[]                // { a, b, length? }
  circles: Circle[]                  // { id?, center, radius, through? }
  triangles: Triangle[]              // { vertices, rightAt?, isoscelesAt?, equilateral? }
  lines: Line[]                      // { a, b }
  midpoints: MidpointConstraint[]
  pointsOnSegments: PointOnSegmentConstraint[]
  perpendiculars: PerpendicularConstraint[]
  parallels: ParallelConstraint[]
  altitudes: AltitudeConstraint[]
  medians: MedianConstraint[]
  angleBisectors: AngleBisectorConstraint[]
  tangents: TangentConstraint[]
  namedTangents: NamedTangentConstraint[]
  pointsOnCircles: PointOnCircleConstraint[]
  circlesByDiameter: CircleByDiameterConstraint[]
  diameterConstraints: DiameterConstraint[]
  lineIntersections: LineIntersectionConstraint[]
  perpendicularThroughPointIntersections: PerpendicularThroughPointIntersectionConstraint[]
  tangentIntersections: TangentIntersectionConstraint[]
  equalLengths: EqualLengthConstraint[]
  equalAngles: EqualAngleConstraint[]
  centroids: CentroidConstraint[]
  // ... and more
}

interface LayoutModel extends GeometryModel {
  pointPositions: Map<string, { x: number; y: number }>
}

type LineRef = { a: string; b: string }
```

### `model/v2Model.ts` (shim)
```typescript
export { enrichModelForV2 } from '../runtime/enrichment.js'
```

### `model/normalize.ts` (shim)
```typescript
export { displayLabel, normalizeModelIds } from '../dsl/canonicalizer.js'
```

---

## `src/geometry/` + `src/layout/` + `src/render/` — Geometry Engine (Layers 13–16)

### `geometry/constraint-solver.ts` — Layer 13 (constraint evaluation)

Evaluates individual geometric constraints. Internal functions used by `buildLayout` and `refineLayoutWithSolver`:
- `solveConstraints(model, points, circles, diagnostics)` — full constraint pass
- `reSolveConstraints(model, points, circles, diagnostics)` — drag re-solve variant
- `updateAngleParametersFromSolvedPositions(model, points)` — persist on-circle angles
- `applyDerivedCircles(model, circles)` — compute incircle/circumcircle
- `diameterConstraintCenterId(c)` — helper

---

### `geometry/solver.ts` — Layer 13 (iterative loop)

```typescript
export function refineLayoutWithSolver(
  model: GeometryModel,
  layout: LayoutModel,
  options?: { iterations?: number }  // default: 160
): LayoutModel
```

Iterative constraint refinement. Stops early if max displacement < threshold.

---

### `layout/layout.ts` — Layer 14

```typescript
export interface LayoutPolicy {
  anchor(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void
  spreadFree(allPointIds: string[], points: Map<string, Point>): void
}

export const DEFAULT_LAYOUT_POLICY: LayoutPolicy

export function buildLayout(
  model: GeometryModel,
  policy?: LayoutPolicy
): LayoutModel
```

Applies constraints in a fixed order to produce initial positions, then calls `buildSceneGraph` to produce the drawable edge list. Critical order: `applyPointOnSegment` → `applyParallelPerpendicular` → `applyMidpoints`.

---

### `render/scene-graph.ts` — Layer 15

```typescript
export function buildSceneGraph(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Map<string, Circle>,
  diagnostics: string[]
): SceneNode[]
```

Converts solved positions to a list of drawable `SceneNode`s (segments, circles, labels). Extends lines to span all collinear points; removes redundant sub-segments.

---

### `render/svg.ts` — Layer 16

```typescript
export function renderSvg(layout: LayoutModel): string
export function renderSvgFromCanvasCoords(...): string
export interface CanvasPoint { id: string; x: number; y: number }
export interface CanvasSegment { a: string; b: string; dashed?: boolean }
export interface CanvasCircle { centerId: string; r: number }
```

Outputs a complete `<svg>...</svg>` string. Applies Y-axis flip internally.

---

### `render/viewport.ts`

```typescript
export function fitToViewport(points: Map<string, Point>, circles: Circle[]): FitInfo
export function computeBoundingBox(points: Map<string, Point>): BoundingBox
export const CANVAS_WIDTH: number
export const CANVAS_HEIGHT: number
export const CANVAS_PADDING: number
export interface ViewportTransform { scale: number; cx: number; cy: number }
```

---

### `geometry/index.ts` — barrel

Re-exports everything from `layout/`, `render/`, and geometry sub-modules:

```typescript
export { buildLayout, DEFAULT_LAYOUT_POLICY } from '../layout/layout.js'
export type { LayoutPolicy } from '../layout/layout.js'
export { refineLayoutWithSolver } from './solver.js'
export { renderSvg, renderSvgFromCanvasCoords } from '../render/svg.js'
export { fitToViewport, computeBoundingBox, ... } from '../render/viewport.js'
export { updateAngleParametersFromSolvedPositions, ... } from './constraint-solver.js'
export { applyDrag } from './drag.js'
```

---

## `src/index.ts` — MCP Entry Point

Tools exposed:

| Tool name | Parser | Solver |
|---|---|---|
| `read_and_draw_geometry` | v1 heuristic | none |
| `read_and_draw_geometry_v2_llm` | LLM (`parseGeometryProblemWithLLM`) | constraint solver (optional, default on) |

Both tools return: `{ parserVersion, parsed, layout, svg }` as JSON text.

v2 additional input params:
- `llmModel?: string`  
- `fallbackToHeuristic?: boolean` (default `true`)  
- `useConstraintSolver?: boolean` (default `true`)  
- `solverIterations?: number` (default `160`, max `2000`)
