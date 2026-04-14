# End-to-End Example

## Input (Vietnamese)
Cho tam giác ABC, M là trung điểm của BC.

## Normalized
Triangle ABC, M is midpoint of BC.

## DSL
{
  "objects": [{"type": "triangle", "points": ["A","B","C"]}],
  "constraints": [{"type": "midpoint", "point": "M", "of": ["B","C"]}]
}

## Canonical
- Points: A, B, C, M
- Construction: midpoint(B,C) → M

## Runtime Graph
B,C → M

## Solver Output
Coordinates assigned

## SVG
Triangle with median AM
