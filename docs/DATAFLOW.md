# Data Flow & Sequence Diagrams

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

