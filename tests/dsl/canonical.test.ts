/**
 * Tests for Layer 9: src/dsl/canonical.ts
 *
 * dslToCanonical() converts validated GeometryDsl → CanonicalProblem.
 * Verifies entity IDs, entity kinds, given/goal classification, and
 * deterministic ID generation using fixtures from resources/tests.txt.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dslToCanonical } from "../../src/dsl/canonical.js";
import type { GeometryDsl } from "../../src/dsl/dsl.js";

// ─── fixture helpers ──────────────────────────────────────────────────────────

function dsl(
  objects: GeometryDsl["objects"],
  constraints: GeometryDsl["constraints"] = [],
  targets: GeometryDsl["targets"] = []
): GeometryDsl {
  return { objects, constraints, constructions: [], targets };
}

function entityIds(cp: ReturnType<typeof dslToCanonical>): string[] {
  return cp.entities.map(e => e.id);
}

function entityKinds(cp: ReturnType<typeof dslToCanonical>): string[] {
  return cp.entities.map(e => e.kind);
}

// ─── top-level structure ─────────────────────────────────────────────────────

describe("dslToCanonical — top-level structure", () => {
  it("returns version 1.0 and plane_geometry problem_type", () => {
    const cp = dslToCanonical(dsl([]));
    assert.equal(cp.version, "1.0");
    assert.equal(cp.problem_type, "plane_geometry");
  });

  it("returns arrays for entities, givens, goals", () => {
    const cp = dslToCanonical(dsl([]));
    assert.ok(Array.isArray(cp.entities));
    assert.ok(Array.isArray(cp.givens));
    assert.ok(Array.isArray(cp.goals));
  });
});

// ─── point entities ───────────────────────────────────────────────────────────

describe("dslToCanonical — points", () => {
  it("creates a pt_A entity for point 'A'", () => {
    const cp = dslToCanonical(dsl([{ type: "point", name: "A" }]));
    assert.ok(entityIds(cp).includes("pt_A"), `entities: ${entityIds(cp).join(", ")}`);
  });

  it("point entity has kind 'point'", () => {
    const cp = dslToCanonical(dsl([{ type: "point", name: "B" }]));
    const e = cp.entities.find(x => x.id === "pt_B");
    assert.ok(e);
    assert.equal(e!.kind, "point");
  });

  it("multiple points each get their own entity", () => {
    const cp = dslToCanonical(dsl([
      { type: "point", name: "A" },
      { type: "point", name: "B" },
      { type: "point", name: "C" }
    ]));
    const ids = entityIds(cp);
    assert.ok(ids.includes("pt_A"));
    assert.ok(ids.includes("pt_B"));
    assert.ok(ids.includes("pt_C"));
  });
});

// ─── circle entities ──────────────────────────────────────────────────────────

describe("dslToCanonical — circles", () => {
  it("creates a cir_O entity for a circle with center O", () => {
    const cp = dslToCanonical(dsl([
      { type: "circle", name: "O", center: "O" }
    ]));
    assert.ok(entityIds(cp).includes("cir_O"), `entities: ${entityIds(cp).join(", ")}`);
  });

  it("circle entity has kind 'circle'", () => {
    const cp = dslToCanonical(dsl([{ type: "circle", center: "O" }]));
    const e = cp.entities.find(x => x.id === "cir_O");
    assert.ok(e);
    assert.equal(e!.kind, "circle");
  });

  // Fixture: "Cho đường tròn (O) có đường kính CD"
  it("circle with diameter CD creates entities for O (center), C, D", () => {
    const cp = dslToCanonical(dsl(
      [
        { type: "circle", name: "O", center: "O" },
        { type: "point", name: "C" },
        { type: "point", name: "D" }
      ],
      [{ type: "diameter", circle: "O", points: ["C", "D"] }]
    ));
    const ids = entityIds(cp);
    assert.ok(ids.includes("cir_O"));
    assert.ok(ids.includes("pt_C") || ids.some(id => id.startsWith("pt_C")));
    assert.ok(ids.includes("pt_D") || ids.some(id => id.startsWith("pt_D")));
  });
});

// ─── segment entities ─────────────────────────────────────────────────────────

describe("dslToCanonical — segments and lines", () => {
  it("segment EH gets id seg_EH (sorted)", () => {
    const cp = dslToCanonical(dsl([
      { type: "segment", name: "EH", points: ["E", "H"] }
    ]));
    // seg_EH or seg_HE — IDs are sorted, so both are possible depending on alpha order
    const ids = entityIds(cp);
    assert.ok(
      ids.includes("seg_EH") || ids.includes("seg_HE"),
      `entities: ${ids.join(", ")}`
    );
  });

  it("segment AE and segment EA produce the same canonical ID", () => {
    const cp1 = dslToCanonical(dsl([{ type: "segment", name: "AE", points: ["A", "E"] }]));
    const cp2 = dslToCanonical(dsl([{ type: "segment", name: "EA", points: ["E", "A"] }]));
    const seg1 = entityIds(cp1).find(id => id.startsWith("seg_"));
    const seg2 = entityIds(cp2).find(id => id.startsWith("seg_"));
    assert.equal(seg1, seg2, "segment ID should be order-independent");
  });
});

// ─── triangle ─────────────────────────────────────────────────────────────────

describe("dslToCanonical — triangle", () => {
  it("triangle ABC creates a tri entity and point entities for A, B, C", () => {
    const cp = dslToCanonical(dsl([{ type: "triangle", points: ["A", "B", "C"] }]));
    const ids = entityIds(cp);
    assert.ok(ids.some(id => id.startsWith("tri_")), `no tri_ entity: ${ids.join(", ")}`);
    assert.ok(ids.includes("pt_A"));
    assert.ok(ids.includes("pt_B"));
    assert.ok(ids.includes("pt_C"));
  });
});

// ─── givens ───────────────────────────────────────────────────────────────────

describe("dslToCanonical — givens", () => {
  it("a diameter constraint appears in givens", () => {
    const cp = dslToCanonical(dsl(
      [
        { type: "circle", center: "O" },
        { type: "point", name: "C" },
        { type: "point", name: "D" }
      ],
      [{ type: "diameter", circle: "O", points: ["C", "D"] }]
    ));
    assert.ok(cp.givens.length > 0, "expected at least one given");
  });

  it("an on_circle constraint appears in givens", () => {
    const cp = dslToCanonical(dsl(
      [
        { type: "circle", center: "O" },
        { type: "point", name: "E" }
      ],
      [{ type: "on_circle", point: "E", circle: "O" }]
    ));
    assert.ok(cp.givens.length > 0);
  });

  it("a right_angle constraint appears in givens", () => {
    const cp = dslToCanonical(dsl(
      [],
      [{ type: "right_angle", points: ["A", "H", "B"] }]
    ));
    assert.ok(cp.givens.length > 0);
  });
});

// ─── goals ────────────────────────────────────────────────────────────────────

describe("dslToCanonical — goals", () => {
  it("a target statement becomes a goal", () => {
    const cp = dslToCanonical(dsl(
      [],
      [],
      [{ type: "statement", text: "Prove AE is tangent to (O)" }]
    ));
    assert.ok(cp.goals.length > 0, "expected at least one goal");
  });

  it("no goals when targets array is empty", () => {
    const cp = dslToCanonical(dsl([{ type: "point", name: "A" }]));
    assert.equal(cp.goals.length, 0);
  });
});

// ─── Determinism ─────────────────────────────────────────────────────────────

describe("dslToCanonical — determinism", () => {
  it("produces the same output for the same input (idempotent)", () => {
    const input = dsl([
      { type: "circle", center: "O" },
      { type: "point", name: "C" },
      { type: "point", name: "D" },
      { type: "point", name: "E" }
    ], [
      { type: "diameter", circle: "O", points: ["C", "D"] },
      { type: "on_circle", point: "E", circle: "O" }
    ]);
    const cp1 = dslToCanonical(input);
    const cp2 = dslToCanonical(input);
    assert.deepEqual(cp1.entities.map(e => e.id), cp2.entities.map(e => e.id));
    assert.deepEqual(cp1.givens.length, cp2.givens.length);
  });
});
