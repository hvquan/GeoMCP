# GeoMCP Architecture (Technical Specification)

## 1. Overview
GeoMCP is a multi-stage system converting multilingual geometry problems (VI/EN/SV)
into interactive SVG visualizations.

## 2. Principles
- LLM handles only semantic parsing
- CanonicalProblem is the source of truth
- Clear separation: semantic → runtime → visual
- Multilingual via normalization (not free translation)
- Parameters are first-class nodes

## 3. Pipeline
1. Input
2. Language Detection
3. Geometry Language Normalization
4. Prompt Builder
5. LLM Adapter
6. Output Extractor
7. Repair
8. DSL Validation
9. DSL Normalization
10. CanonicalProblem
11. Semantic Enrichment
12. Runtime Graph Compiler
13. Geometry Solver
14. Layout
15. Scene Graph
16. SVG Renderer

## 4. Multilingual Support
- Detect language
- Normalize terms
- Canonical geometry language
- Unified parsing pipeline

## 5. Flow
```
Input → Detect → Normalize → Parse → Validate → Canonical → Compile → Solve → Layout → Render
```

## 6. Directory Structure
```
src/
  ai/
  language/
  parsing/
  dsl/
  runtime/
  geometry/
  layout/
  render/
  interactive/
  pipeline/
```

## 7. Interaction
```
Drag → Update → Solve → Layout → Render
```

## 8. Notes
- Easy to swap LLM
- Supports interactive geometry
- Extendable to proof engine
