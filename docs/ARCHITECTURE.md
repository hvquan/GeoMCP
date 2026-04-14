# Geometry Visualization Architecture

## System Overview

GeoMCP is a multi-stage geometry problem-solving system. It converts a natural language geometry problem (Vietnamese, English, or Swedish) into an SVG visualization through language normalization, LLM parsing, DSL normalization, constraint compilation, and solving.

The system exposes two execution surfaces:
- **MCP tool** (`src/index.ts`) — single tool `read_and_draw_geometry`, responds to MCP calls from AI agents
- **HTTP server** (`src/webapp.ts`) — interactive browser UI with draggable points

```
INPUT: Natural Language Problem (VI / EN / SV)
        ↓
    ┌──────────────────────────────────┐
    │  Language Normalization          │  detect lang + canonical phrase map
    │  language/                       │  Layers 1–2 + dynamic few-shot (L3)
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  LLM Parsing Pipeline            │  Prompt build (L3) → call (L4)
    │  llm/ + parsing/                 │  → extract (L5) → repair (L6)
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  DSL Validation & Normalization  │  Schema (L7) → normalize (L8)
    │  dsl/geomcp-schema.ts            │  token repair, alias fix, synthesis
    │  dsl/normalize.ts                │
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  DSL Adapter                     │  RawDSL → Canonical Geometry IR
    │  dsl/adapter.ts                  │  constructs entity graph
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  Runtime Compiler                │  Canonical IR → RuntimeGraph
    │  runtime/compiler.ts             │  topo-sort, dependency edges
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  Solver                          │  propagate coordinates
    │  solver/                         │  initSolvedState → solveAll
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  Scene Graph + Layout + Style    │  SolvedState → render-ready scene
    │  scene/                          │
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  SVG Renderer                    │  StyledScene → SVG string
    │  renderer/svg.ts                 │
    └──────────────┬───────────────────┘
                   ↓
OUTPUT: SVG (returned via MCP) or interactive HTML (via webapp)
```

## Source Directory Structure

```
src/
├── index.ts              — MCP server entry point (single tool: read_and_draw_geometry)
├── webapp.ts             — HTTP server for interactive browser UI
│
├── language/             — Layers 1–3: multilingual normalization (VI/EN/SV)
│   ├── canonical-language.ts — types: DetectedLanguage, CanonicalPhrase,
│   │                           NormalizedGeometryInput
│   ├── detect.ts         — Layer 1: detectLanguage() — Unicode diacritics + vocabulary
│   ├── term-lexicon.ts   — geometry term glossary (VI/EN/SV ↔ canonical)
│   ├── normalize-phrases.ts — Layer 2: detectCanonicalPhrases()
│   │                          maps surface forms → canonical phrase types
│   ├── fewshot-selector.ts  — Layer 3: selectFewShots()
│   └── index.ts          — detectAndNormalize(text) → NormalizedGeometryInput
│
├── llm/                  — Layers 3–6: LLM integration (renamed from ai/)
│   ├── prompt-builder.ts — Layer 3: buildGeometrySystemPrompt() + dynamic variant
│   ├── llm-adapter.ts    — Layer 4: callLlm() (OpenAI-compatible HTTP API)
│   ├── output-extractor.ts — Layer 5: extractJsonObject() — strip markdown, find { }
│   ├── repair.ts         — Layer 6: repairDslJson() + buildRepairPrompt()
│   └── examples/
│       └── dsl-examples.ts — LLM few-shot example bank (source of truth for prompt)
│
├── parsing/              — LLM orchestration (Layers 1–8)
│   ├── dslParser.ts      — parseGeometryDslWithLLM() — wires L1–L8
│   ├── parser.ts         — v1 heuristic regex-based parser (legacy)
│   └── index.ts          — barrel exports
│
├── dsl/                  — DSL types, validation, normalization, and adaptation
│   ├── dsl.ts            — GeometryDsl TypeScript types + expandDslMacros()
│   ├── geomcp-schema.ts  — Layer 7: Zod validation schema for LLM output DSL
│   ├── raw-schema.ts     — RawDSL types (GeoMCP format: objects/constraints/constructions)
│   ├── normalize.ts      — Layer 8: normalizeRawDsl() → NormalizeResult
│   │                       fixes token splits, deduplicates, x-suffix alias repair
│   ├── adapter.ts        — adaptDsl() — RawDSL → CanonicalGeometryIR
│   │                       deferred-point guard, degenerate-foot guard
│   ├── canonical.ts      — CanonicalProblem types + dslToCanonical() (legacy path)
│   ├── canonicalizer.ts  — normalizeModelIds(), displayLabel()
│   ├── desugar.ts        — expandDslMacros() — macro shapes → primitives
│   └── index.ts          — barrel exports
│
├── canonical/
│   └── schema.ts         — CanonicalGeometryIR v1 type definitions
│                           (engine contract between adapter and compiler)
│
├── runtime/
│   ├── compiler.ts       — compileToRuntimeGraph(): CanonicalGeometryIR → RuntimeGraph
│   │                       topo-sort + dependency edge extraction
│   ├── dsl-compiler.ts   — dslToGeometryModel() (legacy test path)
│   ├── enrichment.ts     — enrichModelForV2() (used by legacy compiler)
│   ├── schema.ts         — RuntimeGraph / RuntimeNode type definitions
│   └── edit-policy.ts    — edit-safety policies for interactive mutations
│
├── solver/
│   ├── state.ts          — initSolvedState(): seed free-point coords
│   └── recompute.ts      — solveAll() / recompute(): propagate constraint math
│
├── scene/
│   ├── schema.ts         — SceneGraph / SceneNode type definitions
│   ├── schema.zod.ts     — Zod validator for SceneGraph
│   ├── builder.ts        — buildSceneGraph(): SolvedState → SceneGraph
│   ├── layout.ts         — layout(): assign coords to unpositioned points
│   ├── viewport.ts       — computeViewport(): bounding box + scale
│   ├── style.ts          — applyStyles(): math-space → canvas-space + defaults
│   ├── annotations.ts    — label and annotation helpers
│   ├── parse.ts          — SceneGraph deserialization
│   └── validate.ts       — SceneGraph structural validation
│
├── renderer/
│   └── svg.ts            — renderSvg(): StyledScene → SVG string
│
├── pipeline/
│   ├── index.ts          — runGeometryPipeline() — transport-agnostic end-to-end
│   ├── run-from-canonical.ts  — runFromCanonical(): Canonical IR → SVG
│   ├── run-from-geomcp-dsl.ts — runFromGeomcpDsl(): raw LLM JSON → SVG
│   ├── run-interaction.ts     — interactive drag re-solve pipeline
│   └── run.ts            — lower-level run helpers
│
├── interaction/          — interactive drag/edit types and state
│   ├── types.ts
│   ├── state.ts
│   ├── hit-test.ts
│   └── update.ts
│
├── model/                — Legacy GeometryModel types + re-export shims
│   ├── types.ts          — GeometryModel, LayoutModel, all constraint interfaces
│   ├── v2Model.ts        — shim → runtime/enrichment.ts
│   ├── normalize.ts      — shim → dsl/canonicalizer.ts
│   └── index.ts
│
├── geometry/             — Legacy iterative constraint solver (still used by webapp)
│   ├── constraint-solver.ts
│   ├── solver.ts         — refineLayoutWithSolver()
│   ├── drag.ts
│   └── index.ts
│
├── layout/               — Legacy layout + scene assembly
│   └── layout.ts         — buildLayout()
│
└── render/               — Legacy SVG renderer (still used by webapp)
    ├── scene-graph.ts
    ├── svg.ts
    └── viewport.ts
```

---

## Layer Numbering

| Layer | File(s) | Responsibility |
|---|---|---|
| 1 | `language/detect.ts` | Language Detection — Unicode diacritics + vocabulary heuristics |
| 2 | `language/normalize-phrases.ts` | Geometry Language Normalization — surface forms → canonical phrase types |
| 3 | `language/fewshot-selector.ts` + `llm/prompt-builder.ts` | Prompt Builder — dynamic few-shot selection + full system prompt |
| 4 | `llm/llm-adapter.ts` | LLM Adapter — OpenAI-compatible HTTP call + config resolution |
| 5 | `llm/output-extractor.ts` | Output Extractor — strip markdown, extract `{…}` block |
| 6 | `llm/repair.ts` | Repair / Retry — structural JSON fixes + semantic re-prompt |
| 7 | `dsl/geomcp-schema.ts` | DSL Schema Validation — Zod: raw LLM JSON → typed + validated |
| 8 | `dsl/normalize.ts` | DSL Normalization — token repair, x-suffix alias, point synthesis |
| — | `dsl/adapter.ts` | DSL Adapter — RawDSL → CanonicalGeometryIR (deferred-point, degenerate-foot) |
| — | `runtime/compiler.ts` | Runtime Compiler — Canonical IR → RuntimeGraph (topo-sort) |
| — | `solver/state.ts` + `solver/recompute.ts` | Solver — propagate construction math from free variables |
| — | `scene/builder.ts` + `scene/layout.ts` + `scene/style.ts` | Scene Pipeline — SolvedState → render-ready positioned+styled scene |
| — | `renderer/svg.ts` | SVG Renderer — StyledScene → SVG string (Y-axis flip in style.ts) |

---

## Module Architecture

### Language Layer (`src/language/`)

**Purpose**: Detect input language and normalize surface-form geometry terms into canonical phrase types before any LLM call. Reduces the LLM's job to structural extraction regardless of input language.

**Supported languages**: Vietnamese (`vi`), English (`en`), Swedish (`sv`).

**Integration point**: `detectAndNormalize(text) → NormalizedGeometryInput`. Called as the first step in `runGeometryPipeline`.

**Processing chain**:
```
detectLanguage(text)           — Layer 1: Unicode diacritics + vocabulary heuristics
 → detectCanonicalPhrases()    — Layer 2: regex lexicon scan → CanonicalPhrase[]
 → NormalizedGeometryInput     — { language, canonicalPhrases }
```

`NormalizedGeometryInput` is used in two ways downstream:
1. **Dynamic few-shot selection** (`fewshot-selector.ts`, L3): up to 3 examples scored by language + topic overlap
2. **User message hint**: canonical phrase types appended to LLM user message

---

### LLM Layer (`src/llm/`)

**Purpose**: Isolate all LLM integration details. Previously in `src/ai/`.

Config resolution (all via env vars): `GEOMCP_OPENAI_BASE_URL`, `GEOMCP_OPENAI_API_KEY`, `GEOMCP_OPENAI_MODEL`. Local Ollama endpoints skip the API key check.

**Layers**:
- L3: `prompt-builder.ts` — static + dynamic prompt building; few-shots sourced from `llm/examples/dsl-examples.ts`
- L4: `llm-adapter.ts` — `callLlm()`
- L5: `output-extractor.ts` — `extractJsonObject()`
- L6: `repair.ts` — `repairDslJson()` (6 structural repairs pre-schema) + `buildRepairPrompt()` (semantic retry)

**Few-shot source of truth**: `llm/examples/dsl-examples.ts` — 40 hand-crafted examples. Updated by `npm run test:capture`.

---

### DSL Normalization Pipeline (`src/dsl/normalize.ts` + `src/dsl/adapter.ts`)

This is the critical stage that converts unstable LLM output into a geometrically consistent Canonical IR.

#### `normalize.ts` (Layer 8) — `normalizeRawDsl(input) → NormalizeResult`

Transforms raw LLM JSON before adapting:
1. **Midpoint token splitting** — `"of": ["BC","D"]` → separate point tokens
2. **Intersection truncation** — `"of": [l1,l2,l3]` → `[l1,l2]`
3. **Missing point synthesis** — auto-adds point objects for all referenced letters
4. **Deduplication** — removes duplicate point declarations
5. **x-suffix alias repair (Rule N18)** — `"Ax"` in constraint refs → `"Cx"` when only `Cx` is registered; emits `NormalizeWarning { code: "line_alias_repaired", ... }`

Returns `{ dsl: RawDSL, warnings: NormalizeWarning[] }`.

#### `adapter.ts` — `adaptDsl(dsl) → AdapterResult`

Converts `RawDSL` → `CanonicalGeometryIR`. Key normalization behaviours:

- **Deferred-point guard**: when `AB ⊥ CD` and `B` appears in an intersection constraint, only build `ln.AB`; let the intersection create `pt.B`
- **Degenerate-foot guard**: when `AB ⊥ CD` and `A` is a named endpoint of `CD`, use `perpendicular_through_point + point_on_line` instead of degenerate `foot_of_perpendicular(A, CD) = A`
- **Declared-line alias check**: when resolving a `_declaredLines` entry with x-suffix pattern (e.g. `"Ax"`), checks against already-registered tangent lines before falling back to `free_line`
- **Missing circle inference**: `tangent` constructions without `circle` field infer from `ctx.firstCircleCenter()`

Warnings from both normalize and adapter are merged by callers into a single `warnings: string[]`.

---

### Canonical Geometry IR (`src/canonical/schema.ts`)

Engine-internal contract between the adapter and the runtime compiler.

```
CanonicalGeometryIR {
  version: "canonical-geometry/v1"
  entities: CanonicalEntity[]     — points, lines, circles, segments, triangles,
                                    parameters (radius, angle, length)
  relations?: CanonicalRelation[] — tangent_line, diameter_of_circle, perpendicular, …
}
```

**Design rules**: no pixel coordinates, no render concerns, no interaction affordances. Declarative: describes WHAT, not HOW to compute. `construction` is the primary semantic carrier.

**Construction types** (selected):
- Point: `free_point`, `line_intersection`, `foot_of_perpendicular`, `point_on_circle`, `point_on_line`, `antipode`, `midpoint`, `angle_bisector_foot`
- Line: `free_line`, `line_through_points`, `tangent_at_point`, `perpendicular_through_point`, `parallel_through_point`
- Circle: `circle_center_radius`, `circle_center_through_point`, `circumcircle`, `incircle`
- Parameters: `free_radius`, `free_angle`, `free_length` — first-class draggable scalars

---

### Runtime Compiler (`src/runtime/compiler.ts`)

`compileToRuntimeGraph(ir) → RuntimeGraph`

1. Converts each `CanonicalEntity` → `RuntimeNode`
2. Extracts dependency edges from `construction` fields
3. Topologically sorts (Kahn's algorithm — roots first, cycle detection)
4. Builds fast-lookup indexes (`byId`, `downstream`)

**No coordinates** are computed here — the compiler only builds the graph structure.

**Cycle detection**: if a dep ID doesn't exist in the node map, its edge inflates target in-degree without ever decrementing → stuck nodes → `"Cycle detected"` error. The normalize + adapter pipeline prevents this by ensuring all referenced IDs are registered before use.

---

### Solver (`src/solver/`)

- `initSolvedState(graph, freePoints)` — seeds free-point coords; parameters seeded from `RuntimeParameterNode.value`
- `solveAll(graph, state)` — traverses topo-sorted nodes top-down, evaluates each construction, writes coordinates to state

No iterative convergence — the topo-sorted graph means each node is computed exactly once in dependency order.

---

### Scene Pipeline (`src/scene/`)

```
SolvedState
  → buildSceneGraph()  (scene/builder.ts)  → SceneGraph
  → layout()           (scene/layout.ts)   → PositionedScene
  → computeViewport()  (scene/viewport.ts) → ViewportTransform
  → applyStyles()      (scene/style.ts)    → StyledScene (canvas-space, Y-down)
  → renderSvg()        (renderer/svg.ts)   → SVG string
```

Y-axis flip (math Y-up → SVG Y-down) happens in `applyStyles()`.

---

### Entry Points

#### MCP Server (`src/index.ts`)

Single tool: `read_and_draw_geometry`
- Input: `problem: string`, optional `llmModel: string`
- Calls `runGeometryPipeline(problem, { model: llmModel })`
- Returns JSON with `parserVersion`, `svg`, and intermediate debug fields

#### Pipeline Module (`src/pipeline/`)

`runGeometryPipeline(text, options) → GeometryPipelineResult`
- Options: `model?`, `solverIterations?`, `parseOnly?`
- Always uses `parseGeometryDslWithLLM` (DSL strict mode); throws on LLM parse failure
- Result includes: `svg`, `parserVersion`, `warnings`, `dsl`, `dslExpanded`, `rawDslJson`, `georenderRawDsl`, `georenderCanonical`, `georenderErrors`, `scene`, `normalized`, `llmDebug`

`runFromGeomcpDsl(rawInput) → GeomcpDslResult`
- Merge point for normalize + adapter + compile + solve + scene + SVG
- `normalizeRawDsl()` warnings prefixed `[normalize:code]`, merged with adapter warnings

`runFromCanonical(ir, freePoints) → { scene, svg, errors }`
- Low-level: skips all LLM and DSL stages; compiles IR directly

#### HTTP Server (`src/webapp.ts`)

Interactive web interface. Key endpoints:
- `POST /api/solve` — runs full `runGeometryPipeline`
- `POST /api/dsl` — runs `normalizeRawDsl → adaptDsl → runFromCanonical` (debugging)
- `POST /api/canonical` — re-renders from existing canonical IR after drag
- `POST /api/drag` — interactive re-solve via `run-interaction.ts`

---

## Key Design Decisions

### Single MCP tool (v3 strict)
The system previously exposed v1 (heuristic) and v2 (legacy LLM) tools. Now there is a single `read_and_draw_geometry` tool that always uses the DSL-strict LLM path. No fallback, no parser mode selection. `parserVersion` is always `"v3-dsl-llm-strict"`.

### Two-stage DSL normalization
Raw LLM output goes through two normalization layers before reaching the compiler:
1. `normalizeRawDsl()` — DSL-level: token repair, alias repair, point synthesis
2. `adaptDsl()` — adapter-level: construction inference, deferred-point guard, degenerate-foot guard, declared-line alias check

This separation keeps each layer focused and independently testable.

### Canonical IR as engine contract
`canonical/schema.ts` defines the boundary between the parsing+normalization world and the runtime engine. The adapter produces it; the compiler consumes it. Neither the adapter nor the compiler know about the other's implementation details.

### Topo-sorted evaluation (not iterative)
The new solver (`solver/recompute.ts`) computes each construction once in dependency order. This replaces the old iterative convergence loop (`refineLayoutWithSolver`, 160 passes). No convergence threshold needed; no drift.

The old geometry solver (`geometry/`, `layout/`) remains for the webapp's legacy `buildLayout` path.

### Prompt as code
`GEOMETRY_SYSTEM_PROMPT` is defined in `llm/prompt-builder.ts`. The dynamic variant uses few-shots from `llm/examples/dsl-examples.ts` (40 examples). `resources/prompts/system-prompt.txt` is a manual-testing snapshot only — not read at runtime.

### Y-axis flip in scene pipeline
All internal coordinates use math Y-up until `applyStyles()` in the scene pipeline, which converts to SVG Y-down. The old renderer flipped in `renderSvg()`.

---

## File Reference

```
resources/
├── problem1.txt          — sample geometry problem (Vietnamese)
├── problem2.txt          — sample geometry problem
├── tests.txt             — test corpus of 67 progressively complex problems
└── prompts/              — prompt snapshots for manual LLM testing
    ├── system-prompt.txt — snapshot only — NOT read at runtime
    ├── user-prompt-template.txt
    └── test-manual.sh    — runs a problem through ollama

releases/
├── v1-heuristic.md       — v1 release notes
└── v2-llm-parser.md      — v2 release notes

web/                      — browser UI assets
    index.html            — main interactive UI (Clear button, no mode dropdown)
    app.js                — frontend JS
    config.js / geometry-helpers.js / interactive.js / style.css
    playground.html / step-draw.html

tests/
├── capture-llm.mts       — regenerates llm/examples/dsl-examples.ts via LLM
├── replay-all.mts        — replays all examples through pipeline without LLM
├── run-jsonc.mts         — runs a single JSONC snapshot
├── ai/                   — LLM output extractor + repair tests
├── dsl/                  — schema, desugar, canonical tests
├── geometry/             — geometry constraint solver tests
├── language/             — multilingual normalization tests
├── parsing/              — parser tests
├── pipeline/             — end-to-end pipeline tests (heuristic path)
└── runtime/              — compiler tests
```


## System Overview

GeoMCP is a multi-stage geometry problem-solving system. It converts a natural language geometry problem (Vietnamese, English, or Swedish) into an SVG visualization through language normalization, LLM parsing, constraint compilation, and layout solving.

The system exposes two execution surfaces:
- **MCP tool** (`src/index.ts`) — responds to MCP tool calls from AI agents
- **HTTP server** (`src/webapp.ts`) — interactive browser UI with draggable points

```
INPUT: Natural Language Problem (VI / EN / SV)
        ↓
    ┌──────────────────────────────────┐
    │  Language Normalization          │  detect lang + canonical phrase map
    │  language/                       │  Layers 1–2 + dynamic few-shot (L3)
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  LLM Parsing Pipeline            │  Prompt build (L3) → call (L4)
    │  ai/                             │  → extract (L5) → repair (L6)
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  DSL Validation & Normalization  │  Schema check (L7) → normalize (L8)
    │  dsl/ + parsing/                 │
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  Semantic IR                     │  GeometryDsl → CanonicalProblem (L9)
    │  dsl/canonical.ts                │  + desugar + enrich (L10)
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  Runtime Geometry Graph          │  CanonicalProblem → GeometryModel
    │  runtime/                        │  Layer 11
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  Geometry Solver                 │  Compute geometrically valid positions
    │  geometry/                       │  Layer 12
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  Layout / Beautification         │  Anchor, spread, scene assembly
    │  layout/                         │  Layer 13
    └──────────────╮───────────────────╯
                   ↓
    ┌──────────────────────────────────┐
    │  Scene Graph + SVG Renderer      │  Edge list → SVG output
    │  render/                         │  Layers 14–15
    └──────────────┬───────────────────┘
                   ↓
OUTPUT: SVG (returned via MCP) or Interactive HTML (via webapp)
```

## Source Directory Structure

```
src/
├── index.ts              — MCP server entry point (exposes 2 tools)
├── webapp.ts             — HTTP server for interactive browser UI
│
├── language/             — Layers 1–3: multilingual normalization (VI/EN/SV)
│   ├── canonical-language.ts — types: DetectedLanguage, CanonicalPhrase,
│   │                           NormalizedGeometryInput
│   ├── detect.ts         — Layer 1: detectLanguage() — Unicode diacritics + vocabulary
│   ├── term-lexicon.ts   — geometry term glossary (VI/EN/SV ↔ canonical)
│   ├── normalize-phrases.ts — Layer 2: detectCanonicalPhrases()
│   │                          maps surface forms → canonical phrase types
│   │                          e.g. "thuộc đường tròn" → point_on_circle
│   ├── fewshot-selector.ts  — Layer 3: selectFewShots()
│   │                          scored by language + topic overlap, max 3 examples
│   └── index.ts          — detectAndNormalize(text) → NormalizedGeometryInput
│
├── ai/                   — Layers 3–6: LLM integration
│   ├── prompt-builder.ts — Layer 3: buildGeometrySystemPrompt() (static)
│   │                              + buildDynamicGeometrySystemPrompt(normalized)
│   ├── llm-adapter.ts    — Layer 4: callLlm() (OpenAI-compatible HTTP API)
│   ├── output-extractor.ts — Layer 5: extractJsonObject() — strip markdown, find { }
│   └── repair.ts         — Layer 6: repairDslJson() + buildRepairPrompt()
│
├── parsing/              — Layer 8: DSL parsing and LLM orchestration
│   ├── dslParser.ts      — Layer 8 (normalizeDsl): parseGeometryDslWithLLM()
│   │                       accepts NormalizedGeometryInput → dynamic prompt +
│   │                       appends canonical phrase hint to user message
│   ├── llmParser.ts      — Legacy v2: full LLM parser (direct GeometryModel output)
│   ├── parser.ts         — v1: heuristic regex-based parser (VI/EN patterns)
│   └── index.ts          — barrel exports
│
├── dsl/                  — Layers 7–10: DSL types, validation, semantic IR
│   ├── dsl.ts            — GeometryDsl TypeScript types + low-level helpers
│   ├── schema.ts         — Layer 7: Zod validation schema for GeometryDsl JSON
│   ├── desugar.ts        — Layer 10 (pre-canonical): expandDslMacros() — macros → primitives
│   ├── canonical.ts      — Layer 9: CanonicalProblem types + dslToCanonical()
│   ├── canonicalizer.ts  — normalizeModelIds(), displayLabel()
│   └── index.ts          — barrel exports
│
├── runtime/              — Layers 10–11: semantic IR → runtime constraint graph
│   ├── compiler.ts       — Layer 11: canonicalToGeometryModel() (active path)
│   │                       + dslToGeometryModel() (legacy/test path)
│   └── enrichment.ts     — Layer 10 (post-canonical): enrichModelForV2()
│                           expand high-level constraints into primitives
│
├── model/                — Core data types + backward-compat re-exports
│   ├── types.ts          — GeometryModel, LayoutModel, all constraint interfaces
│   ├── v2Model.ts        — re-export shim → runtime/enrichment.ts
│   ├── normalize.ts      — re-export shim → dsl/canonicalizer.ts
│   └── index.ts          — barrel exports
│
├── pipeline/             — End-to-end orchestration (transport-agnostic)
│   └── index.ts          — runGeometryPipeline(text, options) → layout + SVG
│                           Wires L1–L15. Used by MCP server and webapp.
│
├── geometry/             — Layer 12: Geometry Solver
│   ├── constraint-solver.ts — evaluate individual geometric constraints
│   │                          (perpendicular, on-circle, collinear, distance, …)
│   ├── solver.ts         — refineLayoutWithSolver() — iterative convergence loop
│   ├── drag.ts           — interactive re-solve on drag events (webapp)
│   └── index.ts          — barrel re-exports (incl. from layout/ and render/)
│
├── layout/               — Layer 13: Layout / Beautification
│   └── layout.ts         — buildLayout() — anchor placement + constraint solve
│                           + buildSceneGraph call + spread free points
│
├── render/               — Layers 14–15: Scene graph + SVG rendering
│   ├── scene-graph.ts    — Layer 14: buildSceneGraph() — drawable edge list
│   ├── svg.ts            — Layer 15: renderSvg() — LayoutModel → SVG string
│   └── viewport.ts       — viewport coordinate utilities + Y-flip
│
└── interactive/
    └── index.ts          — exports for interactive UI helpers
```

---

## Layer Numbering

The codebase uses explicit layer comments to document the pipeline depth:

| Layer | File(s) | Responsibility |
|---|---|---|
| 1 | `language/detect.ts` | Language Detection — Unicode diacritics + vocabulary heuristics |
| 2 | `language/normalize-phrases.ts` | Geometry Language Normalization — map surface forms → canonical phrase types |
| 3 | `language/fewshot-selector.ts` + `ai/prompt-builder.ts` | Prompt Builder — dynamic few-shot selection + full system prompt |
| 4 | `ai/llm-adapter.ts` | LLM Adapter — OpenAI-compatible HTTP call + config resolution |
| 5 | `ai/output-extractor.ts` | Output Extractor — strip markdown, extract `{\u2026}` block |
| 6 | `ai/repair.ts` | Repair / Retry — structural JSON fixes + semantic re-prompt |
| 7 | `dsl/schema.ts` | DSL Schema Validation — Zod: raw JSON → typed `GeometryDsl` |
| 8 | `parsing/dslParser.ts` (`normalizeDsl`) | DSL Normalization — fix LLM output quirks (key aliasing, type aliasing) |
| 9 | `dsl/canonical.ts` | CanonicalProblem — stable semantic IR with deterministic IDs + parameter nodes |
| 10 | `dsl/desugar.ts` + `runtime/enrichment.ts` | Semantic Desugaring / Enrichment — expand macros + altitude/median/bisector into primitives |
| 11 | `runtime/compiler.ts` | Runtime Geometry Graph Compiler — `CanonicalProblem` → `GeometryModel` (constraint graph) |
| 12 | `geometry/constraint-solver.ts` + `geometry/solver.ts` | Geometry Solver — evaluate constraints + iterative convergence to valid positions |
| 13 | `layout/layout.ts` | Layout / Beautification — anchor placement, spread, scene graph assembly |
| 14 | `render/scene-graph.ts` | Scene Graph Builder — solved positions → drawable edge list |
| 15 | `render/svg.ts` | SVG Renderer — `LayoutModel` → SVG string (Y-flip + viewport centering) |

---

## Module Architecture

### 0. Language Layer (`src/language/`)

**Purpose**: Detect input language and normalize surface-form geometry terms into canonical phrase types before any LLM call. This reduces the LLM's job to structural extraction only, regardless of input language.

**Supported languages**: Vietnamese (`vi`), English (`en`), Swedish (`sv`).

**Integration point**: `language/index.ts` exports `detectAndNormalize(text) → NormalizedGeometryInput`. Called as the first step in `pipeline/index.ts`'s `runGeometryPipeline`.

**Processing chain**:
```
detectLanguage(text)           — Layer 1: Unicode diacritics + vocabulary heuristics
 → detectCanonicalPhrases()    — Layer 2: regex lexicon scan per language → CanonicalPhrase[]
 → NormalizedGeometryInput     — { language, canonicalPhrases, normalizedText? }
```

**NormalizedGeometryInput** is passed to `parseGeometryDslWithLLM` and used in two ways:
1. **Dynamic few-shot selection** (`fewshot-selector.ts`, L3): `selectFewShots(language, canonicalPhrases)` picks up to 3 examples scored by language match + topic overlap.
2. **User message hint**: The `canonicalPhrases` are appended to the LLM user message as structured context, e.g. `Detected geometry concepts (vi): diameter, tangent, point_on_circle`.

**Key types** (from `canonical-language.ts`):
```typescript
type DetectedLanguage = "vi" | "en" | "sv" | "unknown";

interface CanonicalPhrase {
  type: string;          // e.g. "diameter", "midpoint", "tangent"
  surfaceForm: string;   // original text fragment that matched
  language: DetectedLanguage;
}

interface NormalizedGeometryInput {
  language: DetectedLanguage;
  canonicalPhrases: CanonicalPhrase[];
  normalizedText?: string;
}
```

---

### 1. AI Layer (`src/ai/`)

**Purpose**: Isolate all LLM details. Swapping model providers only requires changes here.

**Key design**: `llm-adapter.ts` reads config from environment variables:
- `GEOMCP_OPENAI_API_KEY` / `OPENAI_API_KEY`
- `GEOMCP_OPENAI_BASE_URL` (default: `https://api.openai.com/v1`, works with Ollama)
- `GEOMCP_OPENAI_MODEL` / `OPENAI_MODEL` (default: `gpt-4.1-mini`)

Local Ollama endpoint is detected automatically and skips API key requirement.

**Layers covered**:
- L3: `prompt-builder.ts` — `buildGeometrySystemPrompt()` (static) + `buildDynamicGeometrySystemPrompt(normalized)` (language-adapted, uses `selectFewShots` from `language/fewshot-selector.ts`)
- L4: `llm-adapter.ts` — `callLlm()` (single provider abstraction)
- L5: `output-extractor.ts` — `extractJsonObject()` (strip markdown, find `{...}`)
- L6: `repair.ts` — `repairDslJson()` + `buildRepairPrompt()` (structural + semantic repair)

---

### 2. Parsing Layer (`src/parsing/` + `src/dsl/`)

**Purpose**: Convert raw text → validated, typed `GeometryDsl` JSON.

**Active parsing path** (used by `parseGeometryDslWithLLM`):
```
Text
 → detectAndNormalize (L1/2) — language detection + canonical phrase extraction
 → buildDynamicGeometrySystemPrompt (L3)
                              — selects language-matched few-shots, builds system prompt
 → callLlm (L4)               — sends system+user prompt to LLM
                                user message includes phraseHint:
                                "Detected geometry concepts (vi): diameter, tangent, …"
 → extractJsonObject (L5)     — strips markdown fences, finds { }
 → repairDslJson (L6)         — structural repairs (missing arrays, string numbers…)
 → dslSchema.parse (L7)       — Zod validates JSON shape
 → normalizeDsl (L8)          — fixes LLM output quirks
 → GeometryDsl                — typed, validated DSL object
 → expandDslMacros (L10)      — desugar macro shapes into primitive objects+constraints
```

`parsing/dslParser.ts` orchestrates Layers 1–6 in `parseGeometryDslWithLLM(text, options)`. The `options.normalized` field carries the `NormalizedGeometryInput` from `pipeline/index.ts` and is used to build the dynamic prompt and user message hint.

**Repair layer** (`ai/repair.ts`, Layer 6):
- `repairDslJson(raw)` — 6 structural fixes applied *before* schema validation:
  - Unwrap accidental outer wrapper keys (`result`, `data`, `output`, …)
  - Convert objects-as-map to array
  - Default missing `constraints` / `objects` to `[]`
  - Coerce string-typed numbers (`"radius": "5"` → `5`)
  - Uppercase point names (`"a"` → `"A"`)
- `buildRepairPrompt(rawResponse, error)` — builds second-LLM-call prompt for semantic errors

**v1 heuristic path**: `parser.ts` uses regex patterns to extract a `GeometryModel` directly. Faster but less robust for complex sentences.

**`dsl/canonical.ts`** — Layer 9 canonical representation:
- Converts `GeometryDsl` → `CanonicalProblem` (stable entity graph)
- Assigns deterministic IDs (`pt_A`, `cir_O`, `ln_CE`, `seg_EH`, `rad_cir_O`, etc.)
- Stamps `EntityMeta` (origin, source, visible, construction provenance) on every entity
- Auto-creates `radius_parameter` and `angle_parameter` entities as first-class graph nodes
- Wired into both execution surfaces (MCP + webapp) as the compilation entry point

---

### 3. Runtime Layer (`src/runtime/`)

**Purpose**: Translate `CanonicalProblem` → `GeometryModel` (the runtime constraint graph). This is what the geometry solver operates on. Named `runtime/` to distinguish the *runtime graph* (coordinates, constraint edges, parameter nodes) from the *semantic IR* (`CanonicalProblem`).

**`runtime/compiler.ts`** (`canonicalToGeometryModel` — active path):
- Walks `CanonicalProblem` entities and givens
- Pre-scans givens to classify perpendicular-through-point and tangent lines
- Produces all `GeometryModel` constraint arrays using stable canonical IDs
- Calls `enrichModelForV2` + `normalizeModelIds` before returning

**`runtime/compiler.ts`** (`dslToGeometryModel` — legacy / test callers):
- Expands DSL macros (`expandDslMacros`) — desugar shorthand shapes
- Walks `objects`, `constraints`, `constructions`, `targets`
- Contains regex raw-text heuristics for specific Vietnamese geometry patterns

**`runtime/enrichment.ts`** (`enrichModelForV2`):
- Expands high-level constraints (altitudes, medians, angle bisectors, etc.) into primitives (`perpendicular`, `pointsOnSegments`, `midpoints`)
- Deduplicates constraint lists
- Called at the end of both compilation paths; re-exported via `model/v2Model.ts` for backward compatibility

---

### 4. Model Layer (`src/model/`)

**Purpose**: Core data type definitions. Implementation of `enrichModelForV2` and `normalizeModelIds` has moved out; `model/` now holds only types and re-export shims.

- `types.ts` — `GeometryModel`, `LayoutModel`, all constraint interfaces (20+ types)
- `v2Model.ts` — `export { enrichModelForV2 } from '../runtime/enrichment.js'`
- `normalize.ts` — `export { normalizeModelIds, displayLabel } from '../dsl/canonicalizer.js'`

---

### 5. Geometry Solver (`src/geometry/`), Layout (`src/layout/`), and Render (`src/render/`)

**Purpose**: Compute point positions from a `GeometryModel`, produce a scene graph, and render to SVG. These three directories represent the final three semantic stages, each with a single responsibility.

#### Geometry Solver (`geometry/`) — Layer 12

`geometry/constraint-solver.ts` evaluates individual geometric constraints: perpendicular, collinear, on-circle, midpoint, intersection, foot-of-perpendicular, etc. Each evaluation function takes the current `Map<id, Point>` and returns updated positions.

`geometry/solver.ts` runs `refineLayoutWithSolver(model, layout, { iterations })` — up to 160 passes calling all constraint evaluators per pass until convergence. Used when `useConstraintSolver: true` (default in v2 LLM path).

`geometry/drag.ts` is the interactive re-solve handler: copies current positions, updates the dragged point, re-applies constraints, persists on-circle angles, rebuilds scene graph. Called by `POST /api/drag` in `webapp.ts`. Does not re-run the full layout pipeline.

#### Layout / Beautification (`layout/`) — Layer 13

`buildLayout(model, policy?)` orchestrates the full L12–L14 sequence:
1. `policy.anchor()` — seed root positions (beautification decision)
2. `solveConstraints()` — derive all other points from geometric constraints (L12)
3. `updateAngleParametersFromSolvedPositions()` — persist on-circle angles
4. `policy.spreadFree()` — place any remaining unconstrained points
5. `buildSceneGraph()` — assemble the final drawable edge list (L14)

The `LayoutPolicy` interface separates beautification decisions from the solver:

```typescript
export interface LayoutPolicy {
  anchor(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void;
  spreadFree(allPointIds: string[], points: Map<string, Point>): void;
}
```

`DEFAULT_LAYOUT_POLICY` implements `ensureBaseShape` (priority: triangle → polygon → circle → segment → point) and `placeUnusedPoints` (radial spread). Pass an alternative `LayoutPolicy` to override without touching the solver or scene-graph.

#### Scene Graph Builder (`render/scene-graph.ts`) — Layer 14

`buildSceneGraph(model, points, circles, diagnostics)` converts a solved `GeometryModel` into the final list of drawable `SceneNode`s:
- Decides which edges to draw (triangle sides, altitude lines, tangent helpers, etc.)
- Extends each segment to span all collinear declared points
- Removes sub-segments superseded by extended ones
- Adds dashed auxiliary segments (altitude foot ↔ base, vertex ↔ orthocenter)

#### SVG Renderer (`render/svg.ts`) — Layer 15

`renderSvg(layout)` converts math coordinates (Y-up) to SVG coordinates (Y-down), applies centering, and outputs a complete SVG string.

`render/viewport.ts` provides coordinate utilities: `fitToViewport`, `computeBoundingBox`, `toCanvasPoint`, `CANVAS_WIDTH/HEIGHT/PADDING`.

---

### 6. Entry Points

#### MCP Server (`src/index.ts`)
Exposes two tools:
- `read_and_draw_geometry` — v1 heuristic pipeline
- `read_and_draw_geometry_v2_llm` — v2 LLM pipeline with optional constraint solver

**v1 pipeline** (tool 1):
```
parseGeometryProblem(text) → buildLayout(model) → renderSvg(layout)
```

**v2 pipeline** (tool 2) via `pipeline/index.ts` → `runGeometryPipeline`:
```
detectAndNormalize(text)                     ← L1/2
  → buildDynamicGeometrySystemPrompt          ← L3: few-shots + system prompt
  → callLlm(messages)                         ← L4: LLM call
  → extractJsonObject(response)               ← L5
  → repairDslJson(raw)                        ← L6
  → dslSchema.parse(json)                     ← L7
  → normalizeDsl(dsl)                         ← L8
  → GeometryDsl
  → expandDslMacros(dsl)                      ← L10 (pre-canonical)
  → dslToCanonical(dslExpanded)               ← L9
  → canonicalToGeometryModel(canonical, text) ← L11 (calls enrichModelForV2 = L10 post)
  → buildLayout(model)                        ← L13 (calls L12 + L14 internally)
  → [refineLayoutWithSolver if enabled]       ← L12
  → renderSvg(layout)                         ← L15
```

`CanonicalProblem` is computed and included in the MCP tool response alongside `parsed`, `layout`, and `svg`. On LLM failure, `fallbackToHeuristic: true` (default) falls back to `parseGeometryProblem` (v1 heuristic) — in that case `canonical` is `undefined` in the response.

#### Pipeline Module (`src/pipeline/`)
`runGeometryPipeline(text, options)` is the transport-agnostic core pipeline used by both the MCP server and the HTTP webapp. It is the single wiring point for the entire L2–L16 chain.

**Full pipeline execution order**:
```
detectAndNormalize(text)                     ← L1/2: language + phrase normalization
 → buildDynamicGeometrySystemPrompt          ← L3: few-shots + system prompt
 → callLlm(messages)                         ← L4
 → extractJsonObject(response)               ← L5
 → repairDslJson(raw)                        ← L6
 → dslSchema.parse(json)                     ← L7
 → normalizeDsl(dsl)                         ← L8
 → expandDslMacros(dsl)                      ← L10 (pre-canonical macro expansion)
 → dslToCanonical(dslExpanded)               ← L9
 → canonicalToGeometryModel(canonical, text) ← L11 (+ L10 enrichment internally)
 → buildLayout(model)                        ← L13 (calls L12 constraint-solve + L14 scene-graph)
 → [refineLayoutWithSolver if enabled]       ← L12
 → renderSvg(layout)                         ← L15
```

**Options**: `model`, `solverIterations`, `fallbackToHeuristic`, `useConstraintSolver`, `parserMode`, `parseOnly`.

**Result** includes: `svg`, `layout`, `parsed` (GeometryDsl), `dsl`, `dslExpanded`, `canonical`, `normalized` (NormalizedGeometryInput), `parserVersion`, `llmDebug`.

#### HTTP Server (`src/webapp.ts`)
Interactive web interface. Serves HTML from `web/`, accepts drag events, reruns the constraint solver on each drag, streams updated SVG back to the browser. Uses the same canonical pipeline as the MCP server (`parseGeometryDslWithLLM` → `dslToCanonical` → `canonicalToGeometryModel`).

---

## Key Design Decisions

### Prompt as code, not file
`GEOMETRY_SYSTEM_PROMPT` lives in `ai/prompt-builder.ts` (TypeScript source), not in a text file. The exported constant `resources/prompts/system-prompt.txt` is a snapshot for manual testing only — it is not read at runtime. Changing the prompt means editing `prompt-builder.ts`. The production path uses `buildDynamicGeometrySystemPrompt(normalized)` which selects language-specific few-shot examples; the static `GEOMETRY_SYSTEM_PROMPT` is the fallback when no language context is available.

### Language normalization feeds LLM context — not just few-shot selection
The multilingual pipeline (`src/language/`) does two things with `NormalizedGeometryInput`:
1. **Few-shot selection**: `selectFewShots(language, canonicalPhrases)` in `fewshot-selector.ts` scores the example bank by language match and topic overlap. This gives the LLM in-distribution examples.
2. **User message hint**: The detected canonical phrase types (e.g. "diameter", "tangent", "point_on_circle") are appended to the LLM user message. This is the critical addition — the LLM sees both the original problem text *and* a structured summary of the geometry concepts detected in the input language. This bridges the gap between surface-form variation and the canonical DSL the LLM must output.

Not translating the input text (LLM translates implicitly via multilingual training) avoids information loss and keeps the normalization layer deterministic and testable.

### Two sources of truth must not diverge
`model/v2Model.ts` and `model/normalize.ts` are shims that re-export from `runtime/` and `dsl/` respectively. They exist only for backward compatibility with `src/index.ts` imports. Do not add new logic to them.

### CanonicalProblem is the semantic source of truth
`dsl/canonical.ts` (Layer 9) defines `CanonicalProblem` and `dslToCanonical()`. It is wired into the main MCP v2 flow via `pipeline/index.ts`: called after `parseGeometryDslWithLLM`, and its output drives compilation via `canonicalToGeometryModel`. The canonical result is included in the MCP tool response. It is the foundation for the future proof engine and semantic constraint solver.

The downstream `GeometryModel` compilation routes through `CanonicalProblem` via `canonicalToGeometryModel` (in `runtime/compiler.ts`) on both execution surfaces. `dslToGeometryModel` is retained for backward-compat with test scripts.

`angle_parameter` entities from `CanonicalProblem` are now carried through as `GeometryModel.angleParameters` (see `model/types.ts`). The constraint solver reads the stored angle to place on-circle points deterministically, and writes the computed angle back on the first pass when `value` is null. After the full solve, `updateAngleParametersFromSolvedPositions` persists final angles into the model. This eliminates drift of free-on-circle points across solver iterations and provides a stable base for future interactive drag (where the drag handler can update `angle_parameter.value` and the solver will enforce it on the next full re-solve).

The `POST /api/drag` endpoint returns `viewportTransform` alongside `svg` so the frontend can update its cached transform after each drag — preventing viewBox drift as points move outside the original bounding box.

### Full recompute on every interaction
The interactive server recomputes all positions from scratch on each drag. No incremental updates. This ensures constraints are always globally consistent.

### Y-axis flip at render time
All internal coordinates use Y-up (standard math). The flip to SVG's Y-down system happens only in `renderSvg()`.

---

## File Reference

```
resources/
├── problem1.txt          — sample geometry problem (Vietnamese)
├── tests.txt             — test corpus of progressively complex problems
└── prompts/              — prompt snapshots for manual LLM testing
    ├── system-prompt.txt — snapshot of GEOMETRY_SYSTEM_PROMPT
    ├── user-prompt-template.txt
    └── test-manual.sh    — runs a problem through ollama

releases/
├── v1-heuristic.md       — v1 release notes
└── v2-llm-parser.md      — v2 release notes

web/
├── index.html            — main interactive UI
├── playground.html       — development playground
└── step-draw.html        — step-by-step visualization
```

