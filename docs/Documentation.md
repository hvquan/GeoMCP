# GeoMCP Documentation

## Overview
GeoMCP is a deterministic geometry system that converts multilingual problem descriptions (Vietnamese, English, Swedish) into consistent SVG visualizations.

### Core Goal
Ensure that:

```
Different languages / different LLMs
→ Same CanonicalProblem
→ Same SVG output
```

---

## Documentation Structure

This repository is organized into clear documentation layers:

### 1. README.md (Entry Point)
- What GeoMCP is
- Demo / usage
- Quick architecture diagram
- Links to deeper docs

---

### 2. ARCHITECTURE.md (System Design)

Defines the high-level structure of the system.

#### Contains:
- Layered architecture
- Module responsibilities
- Directory structure
- Design principles

#### Does NOT contain:
- Step-by-step execution
- Solver details

---

### 3. DATAFLOW.md (Execution Pipeline)

Describes how data flows through the system.

#### Contains:
- Full pipeline stages
- Debugging points
- Error handling
- Constraint ordering

#### Purpose:
Helps developers trace execution and debug issues.

---

### 4. PIPELINE-SPEC.md (Deep Technical Spec)

The most detailed explanation of the system.

#### Contains:
- Full pipeline explanation (step-by-step)
- Determinism guarantees
- Canonical invariants
- Layout optimization loop
- Solver vs Layout separation

#### Key Insight:

> CanonicalProblem is the boundary between non-deterministic parsing and deterministic computation.

---

### 5. MODULE-API-REFERENCE.md (Code Contracts)

Defines all module APIs.

#### Contains:
- Function signatures
- Type definitions
- Input/output contracts

#### Purpose:
- Helps safe refactoring
- Enables swapping components (LLM, solver, etc.)

---

### 6. DESIGN-DECISIONS.md (Recommended)

Captures reasoning behind architecture choices.

#### Example topics:
- Why CanonicalProblem exists
- Why normalization happens before LLM
- Why layout is separate from solver
- Why DSL is normalized

---

## Core Architecture

### Layered System

| Layer | Responsibility |
|------|----------------|
| Input | Raw text |
| Language | Detection + normalization |
| LLM | Semantic parsing |
| DSL | Validation + normalization |
| Canonical | Stable geometry representation |
| Runtime | Dependency graph |
| Solver | Compute geometry |
| Layout | Optimize visual quality |
| Render | SVG output |

---

## Full Pipeline

```
Input
→ Language Detection
→ Geometry Language Normalization
→ Prompt Builder
→ LLM Adapter
→ Output Extraction
→ Repair
→ DSL Validation
→ DSL Normalization
→ CanonicalProblem
→ Semantic Enrichment
→ Runtime Graph Compilation
→ Geometry Solver
→ Layout Optimization
→ Scene Graph
→ SVG Renderer
```

---

## Determinism Strategy

### Problem
Different LLMs and languages produce different outputs.

### Solution
Normalize aggressively before computation.

### Key Stages

#### 1. Geometry Language Normalization

```
"đường cao" → "altitude"
"höjd" → "altitude"
```

#### 2. DSL Normalization

- Resolve tokens ("BC" → segment B-C)
- Expand implicit constructs
- Standardize constraints

#### 3. CanonicalProblem

Single source of truth.

---

## CanonicalProblem

Defines:
- Entities (points, lines, circles)
- Constructions (intersection, midpoint, tangent)
- Relations (parallel, perpendicular)

### Property

```
Same CanonicalProblem → Same Geometry → Same SVG
```

---

## Runtime Graph

Transforms canonical representation into a dependency graph.

### Example

```
A, B → midpoint M
```

- Nodes: geometry objects
- Edges: dependencies

---

## Geometry Solver

### Responsibility
Compute all geometry positions.

### Properties
- Deterministic
- No layout logic
- Constraint-driven

---

## Layout System (Optimization Loop)

Layout improves aesthetics without breaking constraints.

### Key Rule

> Layout can only modify free variables.

---

### Optimization Loop

```
Initialize
→ Solve
→ Iterate:
     mutate free variables
     solve
     evaluate score
→ Select best layout
```

---

### Evaluation Metrics

- Distance distribution
- Angle quality
- Triangle area
- Overlap avoidance
- Viewport balance

---

## Scene Graph

Render-ready structure.

Contains:
- Points
- Lines
- Circles
- Labels

No computation logic.

---

## SVG Renderer

Final stage.

- Converts scene graph to SVG
- Handles scaling and centering

---

## Interaction Flow

```
User drags point
→ Update free variables
→ Solver recomputes
→ Layout adjusts (optional)
→ Re-render SVG
```

---

## Directory Structure

```
src/
  ai/
  language/
  parsing/
  dsl/
  canonical/
  runtime/
  geometry/
  layout/
  render/
  interactive/
  pipeline/
```

---

## Key Design Principles

### 1. LLM Isolation

LLM is used only for parsing.

---

### 2. Canonical Boundary

Everything after canonical must be deterministic.

---

### 3. Separation of Concerns

Each layer has a single responsibility.

---

### 4. Language Independence

Achieved via normalization, not translation.

---

### 5. Model Independence

Only these depend on LLM:
- Prompt Builder
- LLM Adapter
- Output Extractor
- Repair

---

## Key Insight

> If two inputs produce the same CanonicalProblem, they must produce identical SVG output.

---

## Future Extensions

- Geometry proof engine
- Symbolic reasoning
- Constraint explanation
- Interactive theorem exploration

---

## Summary

GeoMCP separates:

```
Meaning → Structure → Computation → Visualization
```

This ensures:
- Stability
- Determinism
- Extensibility

---

**End of Refactored Documentation**

