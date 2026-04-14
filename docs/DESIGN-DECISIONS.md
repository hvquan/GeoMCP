# Design Decisions

## 1. Why CanonicalProblem?
To ensure deterministic output regardless of LLM or language.

## 2. Why Normalize Before LLM?
To reduce ambiguity and guide LLM toward consistent parsing.

## 3. Why Separate Solver and Layout?
Solver ensures correctness.
Layout ensures aesthetics.

Mixing them causes instability.

## 4. Why DSL Normalization?
LLM outputs vary. Normalization ensures consistency.

## Key Principle
Same Canonical → Same SVG
