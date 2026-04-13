/**
 * Unit tests for src/dsl/desugar.ts — macro expansion pass (Layer 8).
 *
 * Verifies that each high-level shape object is desugared into the
 * expected primitive objects + constraints, without losing other entries.
 *
 * Run with:  npm test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expandDslMacros } from "../../src/dsl/desugar.js";
import type { GeometryDsl } from "../../src/dsl/dsl.js";

function dsl(objects: GeometryDsl["objects"], constraints: GeometryDsl["constraints"] = []): GeometryDsl {
  return { objects, constraints, constructions: [], targets: [] };
}

function countType(objects: GeometryDsl["objects"], type: string): number {
  return objects.filter(o => o.type === type).length;
}

function constraintTypes(dsl: GeometryDsl): string[] {
  return dsl.constraints.map(c => c.type);
}

// ─── pass-through ──────────────────────────────────────────────────────────

describe("expandDslMacros — pass-through", () => {
  it("returns unchanged DSL when no macro objects are present", () => {
    const input = dsl([
      { type: "point", name: "A" },
      { type: "circle", name: "O", center: "O" }
    ]);
    const out = expandDslMacros(input);
    assert.equal(out.objects.length, 2);
    assert.equal(out.constraints.length, 0);
  });

  it("preserves existing constraints", () => {
    const input = dsl(
      [{ type: "point", name: "A" }],
      [{ type: "collinear", points: ["A", "B", "C"] }]
    );
    const out = expandDslMacros(input);
    assert.equal(out.constraints.length, 1);
    assert.equal(out.constraints[0].type, "collinear");
  });

  it("preserves constructions and targets", () => {
    const input: GeometryDsl = {
      objects: [],
      constraints: [],
      constructions: [{ type: "draw_line", line: "AB" }],
      targets: [{ type: "statement", text: "Prove AB ∥ CD" }]
    };
    const out = expandDslMacros(input);
    assert.equal(out.constructions.length, 1);
    assert.equal(out.targets.length, 1);
  });
});

// ─── isosceles_triangle ────────────────────────────────────────────────────

describe("expandDslMacros — isosceles_triangle", () => {
  it("replaces with triangle + equal_length constraint", () => {
    const input = dsl([{ type: "isosceles_triangle", points: ["A", "B", "C"], at: "A" }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "triangle"), 1);
    assert.equal(countType(out.objects, "isosceles_triangle"), 0);
    const eqLen = out.constraints.filter(c => c.type === "equal_length");
    assert.equal(eqLen.length, 1);
  });
});

// ─── equilateral_triangle ──────────────────────────────────────────────────

describe("expandDslMacros — equilateral_triangle", () => {
  it("replaces with triangle + 2 equal_length constraints", () => {
    const input = dsl([{ type: "equilateral_triangle", points: ["A", "B", "C"] }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "triangle"), 1);
    const eqLen = out.constraints.filter(c => c.type === "equal_length");
    assert.equal(eqLen.length, 2);
  });
});

// ─── right_triangle ────────────────────────────────────────────────────────

describe("expandDslMacros — right_triangle", () => {
  it("replaces with triangle + right_angle constraint", () => {
    const input = dsl([{ type: "right_triangle", points: ["A", "B", "C"], rightAt: "A" }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "triangle"), 1);
    assert.ok(constraintTypes(out).includes("right_angle"));
  });

  it("defaults rightAt to first point if omitted", () => {
    const input = dsl([{ type: "right_triangle", points: ["A", "B", "C"] }]);
    const out = expandDslMacros(input);
    assert.ok(constraintTypes(out).includes("right_angle"));
  });
});

// ─── right_isosceles_triangle ──────────────────────────────────────────────

describe("expandDslMacros — right_isosceles_triangle", () => {
  it("replaces with triangle + right_angle + equal_length", () => {
    const input = dsl([{ type: "right_isosceles_triangle", points: ["A", "B", "C"], at: "A" }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "triangle"), 1);
    assert.ok(constraintTypes(out).includes("right_angle"));
    assert.ok(constraintTypes(out).includes("equal_length"));
  });
});

// ─── parallelogram ─────────────────────────────────────────────────────────

describe("expandDslMacros — parallelogram", () => {
  it("replaces with polygon + 2 parallel constraints", () => {
    const input = dsl([{ type: "parallelogram", points: ["A", "B", "C", "D"] }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "polygon"), 1);
    assert.equal(out.constraints.filter(c => c.type === "parallel").length, 2);
  });
});

// ─── rectangle ─────────────────────────────────────────────────────────────

describe("expandDslMacros — rectangle", () => {
  it("replaces with polygon + 2 parallel + 1 right_angle", () => {
    const input = dsl([{ type: "rectangle", points: ["A", "B", "C", "D"] }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "polygon"), 1);
    assert.equal(out.constraints.filter(c => c.type === "parallel").length, 2);
    assert.ok(constraintTypes(out).includes("right_angle"));
  });
});

// ─── rhombus ───────────────────────────────────────────────────────────────

describe("expandDslMacros — rhombus", () => {
  it("replaces with polygon + 2 parallel + 1 equal_length", () => {
    const input = dsl([{ type: "rhombus", points: ["A", "B", "C", "D"] }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "polygon"), 1);
    assert.equal(out.constraints.filter(c => c.type === "parallel").length, 2);
    assert.ok(constraintTypes(out).includes("equal_length"));
  });
});

// ─── square ────────────────────────────────────────────────────────────────

describe("expandDslMacros — square", () => {
  it("replaces with polygon + 2 parallel + right_angle + equal_length", () => {
    const input = dsl([{ type: "square", points: ["A", "B", "C", "D"] }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "polygon"), 1);
    assert.equal(out.constraints.filter(c => c.type === "parallel").length, 2);
    assert.ok(constraintTypes(out).includes("right_angle"));
    assert.ok(constraintTypes(out).includes("equal_length"));
  });
});

// ─── trapezoid ─────────────────────────────────────────────────────────────

describe("expandDslMacros — trapezoid", () => {
  it("replaces with polygon + 1 parallel constraint (one pair of parallel sides)", () => {
    const input = dsl([{ type: "trapezoid", points: ["A", "B", "C", "D"] }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "polygon"), 1);
    assert.equal(out.constraints.filter(c => c.type === "parallel").length, 1);
  });
});

// ─── isosceles_trapezoid ───────────────────────────────────────────────────

describe("expandDslMacros — isosceles_trapezoid", () => {
  it("replaces with polygon + 1 parallel + 1 equal_length (legs)", () => {
    const input = dsl([{ type: "isosceles_trapezoid", points: ["A", "B", "C", "D"] }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "polygon"), 1);
    assert.equal(out.constraints.filter(c => c.type === "parallel").length, 1);
    assert.ok(constraintTypes(out).includes("equal_length"));
  });
});

// ─── kite ─────────────────────────────────────────────────────────────────

describe("expandDslMacros — kite", () => {
  it("replaces with polygon + 2 equal_length constraints (adjacent pair equality)", () => {
    const input = dsl([{ type: "kite", points: ["A", "B", "C", "D"] }]);
    const out = expandDslMacros(input);
    assert.equal(countType(out.objects, "polygon"), 1);
    assert.equal(out.constraints.filter(c => c.type === "equal_length").length, 2);
  });
});

// ─── mixed ────────────────────────────────────────────────────────────────

describe("expandDslMacros — mixed DSL", () => {
  it("handles multiple macro objects in sequence", () => {
    const input = dsl([
      { type: "rectangle", points: ["A", "B", "C", "D"] },
      { type: "point", name: "P" }
    ]);
    const out = expandDslMacros(input);
    // rectangle → polygon; point P passes through unchanged
    assert.equal(countType(out.objects, "polygon"), 1);
    assert.equal(countType(out.objects, "point"), 1);
    assert.equal(out.objects.find((o: any) => o.type === "point")?.name, "P");
  });

  it("does not mutate the original DSL", () => {
    const input = dsl([{ type: "square", points: ["A", "B", "C", "D"] }]);
    const originalObjects = [...input.objects];
    expandDslMacros(input);
    assert.deepEqual(input.objects, originalObjects);
  });
});
