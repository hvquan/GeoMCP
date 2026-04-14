# Architecture Documentation

Documentation for the GeoMCP system architecture.

## Documents

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System overview, source directory map, layer numbering, module responsibilities, key design decisions
- **[DATAFLOW.md](./DATAFLOW.md)** — Step-by-step pipeline diagrams, normalization rules, stage details, error debug table
- **[MODULE-API-REFERENCE.md](./MODULE-API-REFERENCE.md)** — All exported functions and types, per module

## Quick Reference: Module Responsibilities

| Module | Input | Output |
|---|---|---|
| `src/language/` | problem text | `NormalizedGeometryInput` |
| `src/llm/` | normalized input | LLM response |
| `src/parsing/dslParser.ts` | text + normalized | `GeometryDsl` |
| `src/dsl/geomcp-schema.ts` | raw LLM JSON | validated `GeometryDsl` |
| `src/dsl/normalize.ts` | raw LLM JSON | `{ dsl: RawDSL, warnings }` |
| `src/dsl/adapter.ts` | `RawDSL` | `CanonicalGeometryIR` + `freePoints` |
| `src/canonical/schema.ts` | — | type definitions only |
| `src/runtime/compiler.ts` | `CanonicalGeometryIR` | `RuntimeGraph` |
| `src/solver/` | `RuntimeGraph` + `freePoints` | `SolvedState` |
| `src/scene/` | `RuntimeGraph` + `SolvedState` | `StyledScene` |
| `src/renderer/svg.ts` | `StyledScene` | SVG string |
| `src/pipeline/run-from-geomcp-dsl.ts` | raw LLM JSON | SVG + intermediates |
| `src/pipeline/index.ts` | problem text | SVG + all debug fields |
| `src/index.ts` | MCP call | JSON + SVG |
| `src/webapp.ts` | HTTP request | HTML + SVG stream |

---

## Quick Navigation

### New to the codebase?
1. [ARCHITECTURE.md](./ARCHITECTURE.md) — directory map + pipeline diagram
2. [DATAFLOW.md](./DATAFLOW.md) — stage-by-stage data flow
3. [MODULE-API-REFERENCE.md](./MODULE-API-REFERENCE.md) — function signatures

### Adding a new LLM-output construct type?
- Add to `dsl/geomcp-schema.ts` (Zod), `dsl/raw-schema.ts` (types)
- Handle in `dsl/adapter.ts` → `processConstraints` / `processObjects`
- Add construction type to `canonical/schema.ts` if needed
- Handle in `runtime/compiler.ts` → `compileToRuntimeGraph`
- Add math evaluation in `solver/recompute.ts`
- Add rendering in `scene/builder.ts` + `renderer/svg.ts`

### Debugging a "Cycle detected" error?
- See DATAFLOW.md — Runtime Compiler: Cycle Detection
- Most common causes: phantom dep from `ctx.cid(undefined)`, undeclared line alias

### Understanding DSL normalization?
- See DATAFLOW.md — DSL Normalization Rules
- `dsl/normalize.ts` for token-level repairs (Rule N18: x-suffix alias)
- `dsl/adapter.ts` for construction-level repairs (deferred-point, degenerate-foot, declared-line alias)

### Planning to add a new language?
- `language/detect.ts` — detection heuristic
- `language/term-lexicon.ts` — term glossary
- `language/normalize-phrases.ts` — phrase patterns
- `language/fewshot-selector.ts` — 2–3 few-shot examples
- `tests/language/language.test.ts` — tests

### Troubleshooting?
- See "Error Scenarios & Debug Points" in [DATAFLOW.md](./DATAFLOW.md)

---

## Common Tasks

| I want to… | Go to |
|---|---|
| Understand a function signature | [MODULE-API-REFERENCE.md](./MODULE-API-REFERENCE.md) |
| Understand the full pipeline flow | [DATAFLOW.md](./DATAFLOW.md) |
| Understand module boundaries | [ARCHITECTURE.md](./ARCHITECTURE.md) — Source Directory Structure |
| Understand design decisions | [ARCHITECTURE.md](./ARCHITECTURE.md) — Key Design Decisions |
| Set up the project / deploy | [../README.md](../README.md) |


Documentation for the GeoMCP system architecture.

## Documents

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System overview, source directory map, layer numbering, module responsibilities, key design decisions
- **[DATAFLOW.md](./DATAFLOW.md)** — Step-by-step pipeline diagrams, stage details, constraint ordering, error debug table
- **[MODULE-API-REFERENCE.md](./MODULE-API-REFERENCE.md)** — All exported functions and types, per module

## Quick Reference: Module Responsibilities

| Module | Input | Output | Layer(s) |
|---|---|---|---|
| `src/language/` | problem text | `NormalizedGeometryInput` | L2–4 |
| `src/ai/` | normalized input | LLM response | L4–7 |
| `src/parsing/dslParser.ts` | text + normalized | `GeometryDsl` | L2–9 |
| `src/dsl/schema.ts` | raw JSON | `GeometryDsl` | L8 |
| `src/dsl/canonical.ts` | `GeometryDsl` | `CanonicalProblem` | L10 |
| `src/dsl/desugar.ts` | `GeometryDsl` | `GeometryDsl` | L11 (pre) |
| `src/runtime/enrichment.ts` | `GeometryModel` | `GeometryModel` | L11 (post) |
| `src/runtime/compiler.ts` | `CanonicalProblem` | `GeometryModel` | L12 |
| `src/geometry/` | `GeometryModel` | solved positions | L13 |
| `src/layout/` | `GeometryModel` | `LayoutModel` | L14 |
| `src/render/` | `LayoutModel` | SVG string | L15–16 |
| `src/pipeline/index.ts` | text | SVG + metadata | L2–16 |
| `src/index.ts` | MCP call | JSON+SVG | entry |
| `src/webapp.ts` | HTTP | HTML+SVG stream | entry |

---

## Quick Navigation

### New to the codebase?
1. [ARCHITECTURE.md](./ARCHITECTURE.md) — directory map + layer diagram
2. [DATAFLOW.md](./DATAFLOW.md) — v2 pipeline step-by-step
3. [MODULE-API-REFERENCE.md](./MODULE-API-REFERENCE.md) — function signatures

### Planning to extend LLM parsing?
- Edit `src/ai/prompt-builder.ts` — add rules or few-shot examples
- Edit `src/dsl/schema.ts` — add new allowed DSL object/constraint types
- Edit `src/parsing/dslParser.ts` → `normalizeDsl` — handle new LLM output quirks
- Edit `src/runtime/compiler.ts` — compile new DSL nodes into `GeometryModel`

### Planning to add a new geometry constraint?
- Add the constraint type to `src/dsl/schema.ts` (Zod) and `src/dsl/dsl.ts` (TypeScript type)
- Handle it in `src/runtime/compiler.ts` → `canonicalToGeometryModel`
- Add enrichment expansion in `src/runtime/enrichment.ts` if it has a high-level form
- Add constraint evaluation in `src/geometry/constraint-solver.ts`
- Add scene rendering in `src/render/scene-graph.ts` if it produces a visual edge

### Planning to support a new language?
- Add detection heuristic in `src/language/detect.ts`
- Add terms to `src/language/term-lexicon.ts`
- Add phrase patterns in `src/language/normalize-phrases.ts`
- Add 2–3 few-shot examples in `src/language/fewshot-selector.ts`
- Add tests in `tests/language/language.test.ts`

### Understanding CanonicalProblem?
- See `src/dsl/canonical.ts` and the "CanonicalProblem (Layer 10)" section in [DATAFLOW.md](./DATAFLOW.md)
- See `dsl/canonical.ts` in [MODULE-API-REFERENCE.md](./MODULE-API-REFERENCE.md) for all entity types and ID conventions

### Troubleshooting?
- See "Error Scenarios & Debug Points" in [DATAFLOW.md](./DATAFLOW.md)
- Point at wrong position → check constraint application order in DATAFLOW.md — Geometry Engine section
- LLM returns invalid DSL → check DATAFLOW.md — LLM Parsing stage detail for repair path

---

## Common Tasks

| I want to… | Go to |
|---|---|
| Understand a function signature | [MODULE-API-REFERENCE.md](./MODULE-API-REFERENCE.md) |
| Understand constraint execution order | [DATAFLOW.md](./DATAFLOW.md) — Geometry Engine section |
| Understand module boundaries | [ARCHITECTURE.md](./ARCHITECTURE.md) — Source Directory Structure |
| Understand design decisions | [ARCHITECTURE.md](./ARCHITECTURE.md) — Key Design Decisions |
| Set up the project / deploy | [../README.md](../README.md) |

