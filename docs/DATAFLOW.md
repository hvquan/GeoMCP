# Data Flow & Sequence Diagrams

## Complete Pipeline (v3 DSL strict — only path)

```
Problem Text
    │
    │ [L1/2] Language Normalization
    │ language/index.ts → detectAndNormalize(text)
    │ → NormalizedGeometryInput { language, canonicalPhrases }
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  LLM Parsing Pipeline         parsing/dslParser.ts           │
│                                                              │
│  [L3] buildDynamicGeometrySystemPrompt(normalized)           │
│       few-shots from llm/examples/dsl-examples.ts            │
│                                                              │
│  user message += phraseHint:                                 │
│    "Detected geometry concepts (vi): diameter, tangent, …"  │
│                                                              │
│  [L4] callLlm()  (llm/llm-adapter.ts)                       │
│  [L5] extractJsonObject()  (llm/output-extractor.ts)         │
│  [L6] repairDslJson()  (llm/repair.ts)                       │
│  [L7] dslSchema.parse()  (dsl/geomcp-schema.ts)              │
│         ├── success → GeometryDsl                            │
│         └── failure → buildRepairPrompt → retry → throw      │
│                                                              │
│  expandDslMacros()  (dsl/desugar.ts) → dslExpanded           │
└──────────────────────────────┬───────────────────────────────┘
                               │ GeometryDsl + raw LLM JSON
    ▼
┌──────────────────────────────────────────────────────────────┐
│  DSL Normalization   dsl/normalize.ts                        │
│                                                              │
│  [L8] normalizeRawDsl(rawLlmJson)                            │
│  1. midpoint token splitting                                 │
│  2. intersection.of truncation to 2 items                    │
│  3. auto-add missing point objects                           │
│  4. deduplicate point objects                                │
│  5. x-suffix alias repair ("Ax" → "Cx", warns)              │
│  → { dsl: RawDSL, warnings: NormalizeWarning[] }             │
└──────────────────────────────┬───────────────────────────────┘
                               │ RawDSL + warnings
    ▼
┌──────────────────────────────────────────────────────────────┐
│  DSL Adapter   dsl/adapter.ts                                │
│                                                              │
│  adaptDsl(rawDsl) — RawDSL → CanonicalGeometryIR             │
│                                                              │
│  processObjects():                                           │
│    circle   → free_point + free_radius + circle_center_radius│
│    triangle → 3× free_point + triangle_from_points           │
│    point    → deferred (resolved by constraints)             │
│    segment  → deferred (resolved after points known)         │
│    line     → registered in _declaredLines                   │
│                                                              │
│  processConstraints():                                       │
│    diameter   → point_on_circle + antipode + segment         │
│    on_circle  → free_angle + point_on_circle                 │
│    tangent    → tangent_at_point (infers circle if missing)  │
│    perpendicular + intersection pair → foot_of_perpendicular │
│    perpendicular alone:                                      │
│      deferred-point guard: if foot is in intersectionPoints  │
│        → only build perpendicular_through_point line         │
│      degenerate-foot guard: if from-point is on line2        │
│        → perpendicular_through_point + point_on_line         │
│      else → foot_of_perpendicular                            │
│    intersection → line_intersection                          │
│      resolveOrCreateLine():                                  │
│        declared _declaredLines + x-suffix alias check        │
│        segment-like "AE" + both points known → line_through  │
│    median    → midpoint + ensureSegment                      │
│    bisector  → angle_bisector_foot + ensureSegment           │
│                                                              │
│  postProcess(): free declared points, free declared lines,   │
│                 resolve pending segments                     │
│                                                              │
│  → { canonical: CanonicalGeometryIR, freePoints, warnings }  │
└──────────────────────────────┬───────────────────────────────┘
                               │ CanonicalGeometryIR
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Runtime Compiler   runtime/compiler.ts                      │
│                                                              │
│  compileToRuntimeGraph(ir)                                   │
│  1. convert each entity → RuntimeNode                        │
│  2. extract dep edges from construction fields               │
│  3. Kahn's topo-sort (cycle detection)                       │
│  4. build byId + downstream indexes                          │
│  → RuntimeGraph                                              │
└──────────────────────────────┬───────────────────────────────┘
                               │ RuntimeGraph
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Solver   solver/                                            │
│                                                              │
│  initSolvedState(graph, freePoints)                          │
│  → SolvedState (free points seeded, derived points absent)   │
│                                                              │
│  solveAll(graph, state)                                      │
│  → traverse topo order, evaluate each construction once      │
│  → SolvedState (all coords resolved)                         │
└──────────────────────────────┬───────────────────────────────┘
                               │ SolvedState
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Scene Pipeline   scene/                                     │
│                                                              │
│  buildSceneGraph(graph, state)  → SceneGraph                 │
│  layout(scene)                  → PositionedScene            │
│  computeViewport(positioned)    → ViewportTransform          │
│  applyStyles(positioned, vp)    → StyledScene                │
│    (Y-up → Y-down flip happens here)                         │
│                                                              │
│  renderSvg(styled)  (renderer/svg.ts)                        │
│  → SVG string                                                │
└──────────────────────────────────────────────────────────────┘
                               │
    ▼
OUTPUT: SVG (via MCP response) or HTML (via webapp streaming)
```

---

## Warning Merge Flow

Warnings from the two normalize layers are merged in `runFromGeomcpDsl`:

```
normalizeRawDsl()  → NormalizeWarning[]
                     prefixed "[normalize:code] message"
adaptDsl()         → string[]
                     plain adapter messages

merged → warnings: string[]   (returned in GeomcpDslResult)

runGeometryPipeline() adds further:
  "GeoRender error: ..." for any compile/solve errors
```

---

## Stage Detail: DSL Normalization Rules

### Normalize layer (dsl/normalize.ts) — Rule N18: x-suffix alias repair

Applies to `intersection.of`, `perpendicular.line1/2`, `parallel.line1/2`, `on_line.line`.

```
collect registeredLines:
  objects[type=line].name  +  constraints/constructions[type=tangent].line

for each line ref in constraints/constructions:
  if ref not in registeredLines
    and ref matches /^[A-Z][a-z]$/
    and exactly 1 registered line shares the same trailing char:
      replace ref with that line → emit NormalizeWarning
      { code: "line_alias_repaired",
        message: 'Repaired unknown line "Ax" → "Cx" (same suffix 'x').' }
```

### Adapter layer (dsl/adapter.ts) — declared-line alias check

Fires when `resolveOrCreateLine` is called for a name in `_declaredLines`:

```
if name matches /^[A-Z][a-z]$/
  and exactly 1 already-registered line (in lineIds) shares the same suffix:
    alias → emit adapter warning
    { 'Declared line "Ax" aliased to existing line "Cx" (same suffix 'x')' }
```

This catches the case where `"Ax"` is declared in `objects[]` (so the normalize layer doesn't touch it) but is actually a mistaken name for the tangent `"Cx"` that the adapter already registered while processing the tangent constraint.

---

## Stage Detail: Perpendicular Pattern Recognition

```
perpendicular { line1: "OA", line2: "CE" }

1. Build intersectionPoints set from all intersection constructions.
   If "A" is in intersectionPoints → deferred-point guard.

2a. Deferred-point guard: A will be defined by intersection.
    → build ln.OA = perpendicular_through_point(pt.O, ln.CE)
    → do NOT create pt.A here

2b. No intersection for A:
    parse line1 name → pts1 = ["O","A"]
    if pt.O known and pt.A unknown:
      check degenerate-foot: is pt.O an endpoint of line2 (CE)?
        → NO → pt.A = foot_of_perpendicular(pt.O, ln.CE) + seg.OA
          (standard "EH ⟂ CD" pattern where E is unknown)

perpendicular { line1: "DH", line2: "CD" }
    pts1 = ["D","H"], pt.D known, pt.H unknown
    degenerate-foot check: is pt.D an endpoint of ln.CD? → YES
    → ln.DH = perpendicular_through_point(pt.D, ln.CD)
    → pt.H = point_on_line(ln.DH)  (underdetermined on the perp line)
```

---

## Stage Detail: Runtime Compiler — Cycle Detection

```
compileToRuntimeGraph(ir):
  for each entity:
    node = { id, kind, construction }
    for each dep in construction deps:
      if dep not in nodeMap → phantom dep entry inflates in-degree
                              without ever decrementing → node stuck
                              → "Cycle detected: ..."

Prevention:
  normalizeRawDsl  → ensures alias repair happens before compilation
  adaptDsl         → only emits dep references for IDs it registers
  declared-line alias check → prevents free_line from shadowing tangent
  missing-circle inference → prevents "circ.undefined" phantom dep
```

---

## Stage Detail: Language Normalization

```
detectLanguage(text)  [language/detect.ts]
├── Vietnamese: Unicode diacritics (à, ê, ố, …)
├── Swedish:   characteristic words (cirkel, vinkelrät, …)
└── English:   fallback
        │
        ▼
detectCanonicalPhrases(text, lang)  [language/normalize-phrases.ts]
├── regex lexicon per language
│   "thuộc đường tròn" → { type: "point_on_circle" }
│   "đường kính"       → { type: "diameter" }
└── returns CanonicalPhrase[]
        │
        ▼
NormalizedGeometryInput { language, canonicalPhrases }
```

---

## Interactive Drag Flow (webapp.ts)

```
Browser
  │
  ├─ drag on point P ──────────────────────┐
  │                              webapp.ts  │
  │  POST /api/drag              receives   │
  │  ◄─────────────────────────  { point, x, y, ir, freePoints }
  │
  │  pipeline/run-interaction.ts:
  │    update freePoints[P] = { x, y }
  │    runFromCanonical(ir, freePoints)
  │      → compile → solve → scene → SVG
  │
  ├─◄────── { svg, viewportTransform } ─── webapp.ts
  │
  └─ replace <svg>, update cached transform
```

No incremental update — full recompute from canonical IR on every drag.

---

## Error Scenarios & Debug Points

| Symptom | Where to look |
|---|---|
| LLM returns invalid JSON | `llm/output-extractor.ts` — `extractJsonObject` |
| Zod validation error | `dsl/geomcp-schema.ts` — check allowed types |
| `pt.A` is `free_point` instead of intersection | Adapter: `"Ax"` declared in objects — check declared-line alias check |
| Cycle detected in constraint graph | Compiler: phantom dep — check adapter's `ctx.cid(undefined)` or undeclared alias |
| `pt.H` = `foot_of_perpendicular(D, CD)` = D | Degenerate foot: D is endpoint of CD — check degenerate-foot guard |
| Warning `line_alias_repaired` | Normalize: `"Ax"` in constraint ref repaired to `"Cx"` — expected |
| SVG coordinates inverted | `scene/style.ts` — Y-flip is `cy - y * scale` |
| LLM API key error | `llm/llm-adapter.ts` — check env vars; local base URL bypasses key check |
| Missing circle inferred | Adapter tangent case: `circle` field missing → `firstCircleCenter()` used |


## Complete Pipeline: v2 LLM path (primary)

```
Problem Text
    │
    │ [L2/L3] Language Normalization
    │ language/index.ts → detectAndNormalize(text)
    │ → NormalizedGeometryInput { language, canonicalPhrases }
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  LLM Parsing Pipeline                                        │
│                                                              │
│  [L4] buildDynamicGeometrySystemPrompt(normalized)           │
│       └→ selectFewShots(language, canonicalPhrases)          │
│          └→ system prompt with language-matched examples     │
│                              │                               │
│  user message += phraseHint:                                 │
│    "Detected geometry concepts (vi): diameter, tangent, …"  │
│                              │                               │
│  [L5] callLlm (ai/llm-adapter.ts)                           │
│                              │                               │
│                              ▼                               │
│                       LLM response text                      │
│                              │                               │
│  [L6] extractJsonObject (ai/output-extractor.ts)             │
│                              │                               │
│                              ▼                               │
│                       raw JSON object                        │
│                              │                               │
│  [L7] repairDslJson (ai/repair.ts)                           │
│  [L8] dslSchema.safeParse (dsl/schema.ts)                    │
│         ├── success → GeometryDsl                            │
│         └── failure → LLM repair (multi-turn)                │
│                        → retry safeParse                     │
│                        → cleanup fallback                    │
│  [L9] normalizeDsl (parsing/dslParser.ts)                    │
│                              │                               │
│                              ▼                               │
│                          GeometryDsl                         │
└──────────────────────────────┬───────────────────────────────┘
                               │
    ▼
 [L11 pre] expandDslMacros (dsl/desugar.ts)
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Canonical Representation  (dsl/canonical.ts)                │
│                                                              │
│  [L10] dslToCanonical(dsl)                                   │
│  → assign stable IDs (pt_A, cir_O, ln_CE…)                  │
│  → stamp EntityMeta (origin, source, visible)                │
│  → create radius_parameter + angle_parameter nodes           │
│  → CanonicalProblem                                          │
└──────────────────────────────┬───────────────────────────────┘
                               │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Runtime Geometry Graph  (runtime/compiler.ts)               │
│                                                              │
│  [L12] canonicalToGeometryModel(canonical, rawText)          │
│  → entity pass: points, circles, lines, segments, triangles  │
│  → given pass: diameter, on_circle, tangent, perp,           │
│               intersection (perp > tangent > line priority)  │
│  → GeometryModel (raw constraint arrays)                     │
│                                                              │
│  [L11 post] enrichModelForV2 (runtime/enrichment.ts)         │
│  → expand altitudes/medians/bisectors into primitives        │
│  → GeometryModel (enriched)                                  │
│                                                              │
│  normalizeModelIds (dsl/canonicalizer.ts)                    │
│  → prefix all IDs: "point:A", "circle:O", "line:AB"         │
└──────────────────────────────┬───────────────────────────────┘
                               │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Geometry Engine                                             │
│                                                              │
│  [L14] buildLayout(model)  (layout/layout.ts)                │
│    1. applyPointOnSegment                                    │
│    2. applyParallelPerpendicular                             │
│    3. applyMidpoints           ← ORDER MATTERS               │
│    4. special constraints                                    │
│    5. [L15] buildSceneGraph   ← assemble drawable edges      │
│  → LayoutModel (initial positions + segment list)            │
│                                                              │
│  [L13] refineLayoutWithSolver(model, layout, { iter: 160 })  │
│    loop 160×: apply all constraint types (geometry/solver.ts)│
│  → LayoutModel (converged positions)                         │
│                                                              │
│  [L16] renderSvg(layout)  (render/svg.ts)                    │
│    flip Y-axis, center, generate SVG elements                │
│  → SVG string                                                │
└──────────────────────────────────────────────────────────────┘
                               │
    ▼
OUTPUT: SVG (via MCP) or NDJSON-streamed HTML (via webapp)
```

---

## Complete Pipeline: v1 heuristic path (fallback)

```
Problem Text
    │
    ▼
parseGeometryProblem (parsing/parser.ts)
  regex patterns → GeometryModel (no enrichment needed)
    │
    ▼
buildLayout(model) → renderSvg(layout)
    │
    ▼
SVG output
```

The v2 tool (`read_and_draw_geometry_v2_llm`) falls back to this path when  
`fallbackToHeuristic: true` (default) and the LLM call fails.

---

## Stage Detail: Language Normalization (Layers 2–3)

```
detectLanguage(text)          [language/detect.ts, L2]
├── Vietnamese: Unicode diacritics present  (à, ê, ố, …)
├── Swedish:   characteristic words (cirkel, vinkelrät, …)
└── English:   fallback
        │
        ▼
detectCanonicalPhrases(text, lang)  [language/normalize-phrases.ts, L3]
├── scans regex lexicon for each language
├── e.g. "thuộc đường tròn" → { type: "point_on_circle", … }
└── returns CanonicalPhrase[]
        │
        ▼
NormalizedGeometryInput { language, canonicalPhrases }
```

The `canonicalPhrases` array drives two downstream behaviours (L4):
- **Few-shot selection** — `selectFewShots(language, phrases)` in `fewshot-selector.ts`
- **User message hint** — appended to the LLM user message:
  `"Detected geometry concepts (vi): diameter, tangent, point_on_circle"`

---

## Stage Detail: LLM Parsing (Layers 4–9)

```
callLlm(systemPrompt, userPrompt, options)  [ai/llm-adapter.ts, L5]
  │
  ├── reads config from env:
  │     GEOMCP_OPENAI_BASE_URL (default: api.openai.com/v1)
  │     GEOMCP_OPENAI_API_KEY
  │     GEOMCP_OPENAI_MODEL    (default: gpt-4.1-mini)
  │
  ├── local base URL detected → skip API key requirement (Ollama)
  │
  └── returns: LlmResponse { text: string, model: string }
          │
          ▼
  extractJsonObject(text)
  ├── if text starts with "{" → JSON.parse(text)
  └── else find first { ... last } → JSON.parse(slice)
          │
          ▼
  dslSchema.parse(rawJson)           [Zod, strict]
  ├── validates allowed object types (30+ variants)
  ├── validates constraint types (14 variants)
  ├── validates construction types (5 variants)
  └── returns: GeometryDsl (fully typed)
          │
          ▼
  normalizeDsl(raw, problemText)
  ├── fix objects as map → convert to array
  ├── normalize key aliases (e.g. "name" vs "id")
  ├── fix constraint tangent field variance
  └── returns: GeometryDsl (quirks fixed)
```

---

## Stage Detail: Runtime Geometry Graph Compiler (Layer 12)

### Active path: `canonicalToGeometryModel` (`runtime/compiler.ts`)

```
canonicalToGeometryModel(canonical, rawText)
  │
  ├── pre-scan givens:
  │     perpendicular_through_point → perpThroughLines map
  │     tangent_at_point            → tangentLines map
  │
  ├── entity pass:
  │     point   → points.add(ptRaw(id))
  │     circle  → circles.push (center + radius=120)
  │     line    → lines.push if has through-points; skip perp-through lines
  │     segment → addSegment
  │     triangle → triangles.push + addSegment for each side
  │
  ├── given pass:
  │     diameter_of_circle   → circlesByDiameter + diameterConstraints
  │     point_on_circle      → pointsOnCircles
  │     tangent_at_point     → namedTangents (with linePoint) or tangents
  │     perpendicular_through_point → (handled at intersection_of_lines)
  │     intersection_of_lines (priority: perp > tangent > regular):
  │       perp  → perpendicularThroughPointIntersections + perpendiculars
  │       tan   → tangentIntersections
  │       plain → lineIntersections
  │     foot_of_perpendicular → perpendiculars + pointsOnSegments
  │     midpoint_of_segment   → midpoints + addSegment
  │     point_on_segment      → pointsOnSegments
  │     perpendicular_lines   → perpendiculars
  │     parallel_lines        → parallels
  │     equal_length / equal_angle / right_angle
  │
  └── call enrichModelForV2 + normalizeModelIds
      → returns final normalized GeometryModel
```

### Legacy path: `dslToGeometryModel` (still used by test scripts / `tests/runtime/`)

```
expandDslMacros(dsl)
  ├── expand right_triangle → triangle + right_angle constraint
  └── expand other shorthand shapes

dslToGeometryModel(dsl, rawText)
  ├── walk dsl.objects / constraints / constructions
  ├── handle anonymous perpendicular lines (unresolvedPerpByLineName map)
  ├── raw-text regex heuristics for specific geometry patterns
  └── call enrichModelForV2 + normalizeModelIds
```

**Special case: anonymous perpendicular line** (legacy path only)  
"Qua O kẻ đường thẳng vuông góc với CE, cắt Cx tại A" produces:
- constraint `perpendicular(l1, CE)` with `l1` unresolved
- construction `intersection(A, [l1, Cx])`  
In the canonical path this is handled cleanly: `perpendicular_through_point` given + `intersection_of_lines` given → `perpendicularThroughPointIntersections { through: O, toLine: CE, withLine: CX, intersection: A }`.

---

## Stage Detail: Geometry Engine

### Layout + Constraint Application Order (`layout/layout.ts`, `geometry/constraint-solver.ts`)

```
buildLayout(model)
│
├─ 1. Place all circles (center + radius)
├─ 2. Place all triangle vertices
├─ 3. Place free points (random in viewport)
│
├─ 4. applyPointOnSegment()     ← H onto segment CD
├─ 5. applyParallelPerpendicular() ← refine H via EH ⊥ CD
├─ 6. applyMidpoints()          ← M = midpoint(E, H)  [needs H from step 5]
├─ 7. applyAltitudes()
├─ 8. applyMedians()
├─ 9. applyAngleBisectors()
├─ 10. applyLineIntersections() ← A = l1 ∩ Cx
│       (perpendicularThroughPoint, tangentIntersection, etc.)
├─ 11. buildSceneGraph()        ← decide which edges to draw, extend to collinear
│
└─ returns LayoutModel (positions + segment list)
```

Steps 4–6 **must** run in this order. If `applyMidpoints` runs before  
`applyParallelPerpendicular`, M is computed from the wrong (pre-perp) H position.

### Solver convergence

`refineLayoutWithSolver` runs up to 160 iterations. Each iteration:
1. Applies every constraint type in sequence (perpendiculars, midpoints, on-segment, etc.)
2. Checks max displacement — stops early if below threshold

160 iterations is sufficient for all tested problems. Increasing it only adds cost without accuracy improvement for well-posed problems.

### SVG coordinate transform

```
Math (Y-up)      SVG (Y-down)
(x, y)     →     (cx + x * scale, cy - y * scale)
                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                  cy - y  =  Y-axis flip
```

`cx`, `cy` are the viewport center. Applied in `renderSvg()` for every point.

---

## Interactive Drag Flow (webapp.ts)

```
Browser
  │
  ├─ mousedown on point P ──────────────────┐
  │                                         │
  │                            webapp.ts    │
  │                            receives:    │
  │  ◄────────────────────────  { point: "P", x, y }
  │
  │  recompute sequence:
  │    1. updateDriverPoint(P.name, x, y)
  │    2. projectOntoConstrainedSegments(P)
  │    3. applyParallelPerpendicular()
  │    4. applyMidpoints()
  │    5. iterateConstraints(160)
  │    6. renderSvg()
  │
  ├─◄──── new SVG string ─────────── webapp.ts
  │
  └─ replaces <svg> in DOM
```

"Driver points" are the user-controlled free points (A, C, D, E on circle, etc.).  
"Derived points" (H, M, B, etc.) are fully determined by constraints and are  
repositioned automatically.

---

## CanonicalProblem (Layer 10)

`dsl/canonical.ts` is the semantic source of truth. It sits between the validated `GeometryDsl` and the `GeometryModel`, assigns stable entity IDs, and stamps provenance metadata on every object. Wired into the main pipeline via `pipeline/index.ts`.

```
GeometryDsl
    │
    ▼  dslToCanonical()
CanonicalProblem {
  entities: Map<string, CanonicalEntity>
  givens:   CanonicalGiven[]
  goals:    CanonicalGoal[]
}
    │
    ▼  runtime/compiler.ts (L12) → refineLayoutWithSolver → renderSvg
```

Entity ID conventions:
- Points: `pt_A`, implicit: `pt_i_001`
- Circles: `cir_O`, radius param: `rad_cir_O`
- Lines: `ln_CE` (sorted), tangent: `ln_tan_C_on_cir_O`, perp: `ln_perp_O_to_ln_CE`
- Segments: `seg_EH` (sorted endpoints)
- Rays: `ray_A_B` (NOT sorted — direction preserved)
- Angle param: `ang_E_on_cir_O`

---

## Error Scenarios & Debug Points

| Symptom | Where to look |
|---|---|
| LLM returns invalid JSON | `output-extractor.ts` — check `extractJsonObject` |
| Zod validation error | `dsl/schema.ts` — check allowed types; `parsing/dslParser.ts` — check `normalizeDsl` |
| Point at wrong position | `layout/layout.ts` — check constraint application order |
| Derived point (e.g. M) not updating | Layout order: `applyMidpoints` must run after `applyParallelPerpendicular` |
| Solver diverges / oscillates | `geometry/solver.ts` — check iteration count and damping |
| SVG coordinates inverted | `render/svg.ts` — Y-flip is `cy - y * scale` |
| LLM API key error | `ai/llm-adapter.ts` — check env vars; local base URL bypasses key check |
| `model/v2Model.ts` behavior changed | Real code is in `runtime/enrichment.ts` — `v2Model.ts` is a shim |

