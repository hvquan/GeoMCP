/**
 * Tests for Layer 6: src/dsl/schema.ts
 *
 * Verifies that the Zod schema accepts valid DSL shapes and rejects invalid ones.
 * Uses problem fragments from resources/tests.txt as fixtures.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dslSchema } from "../../src/dsl/schema.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

function valid(objects: unknown[], constraints: unknown[] = []) {
  return { objects, constraints, constructions: [], targets: [] };
}

function parse(input: unknown) {
  return dslSchema.safeParse(input);
}

// ─── valid inputs ─────────────────────────────────────────────────────────────

describe("dslSchema — valid inputs", () => {

  it("accepts an empty DSL", () => {
    const r = parse({ objects: [], constraints: [], constructions: [], targets: [] });
    assert.equal(r.success, true);
  });

  it("accepts a single point", () => {
    const r = parse(valid([{ type: "point", name: "A" }]));
    assert.equal(r.success, true);
  });

  it("accepts a circle with center and radius", () => {
    const r = parse(valid([
      { type: "point", name: "O" },
      { type: "circle", center: "O", radius: 5 }
    ]));
    assert.equal(r.success, true);
  });

  it("accepts a triangle with three points", () => {
    const r = parse(valid([
      { type: "triangle", points: ["A", "B", "C"] }
    ]));
    assert.equal(r.success, true);
  });

  it("accepts a segment", () => {
    const r = parse(valid([{ type: "segment", points: ["A", "B"] }]));
    assert.equal(r.success, true);
  });

  it("accepts a diameter constraint", () => {
    const r = parse(valid(
      [
        { type: "point", name: "C" },
        { type: "point", name: "D" },
        { type: "circle", center: "O" }
      ],
      [{ type: "diameter", circle: "O", points: ["C", "D"] }]
    ));
    assert.equal(r.success, true);
  });

  it("accepts on_circle constraint", () => {
    const r = parse(valid(
      [{ type: "point", name: "E" }, { type: "circle", name: "O" }],
      [{ type: "on_circle", point: "E", circle: "O" }]
    ));
    assert.equal(r.success, true);
  });

  it("accepts right_angle constraint", () => {
    const r = parse(valid([], [{ type: "right_angle", points: ["A", "B", "C"] }]));
    assert.equal(r.success, true);
  });

  it("accepts parallel and perpendicular constraints", () => {
    const r = parse(valid([], [
      { type: "parallel", line1: "AB", line2: "CD" },
      { type: "perpendicular", line1: "AB", line2: "EF" }
    ]));
    assert.equal(r.success, true);
  });

  it("accepts equal_length constraint", () => {
    const r = parse(valid([], [
      { type: "equal_length", segments: [["A", "B"], ["C", "D"]] }
    ]));
    assert.equal(r.success, true);
  });

  // ── Fixtures from resources/tests.txt ───────────────────────────────────────

  it("accepts DSL for 'circle with diameter CD + point E on circle'", () => {
    const r = parse(valid(
      [
        { type: "circle", name: "O", center: "O" },
        { type: "point", name: "C" },
        { type: "point", name: "D" },
        { type: "point", name: "E" }
      ],
      [
        { type: "diameter", circle: "O", points: ["C", "D"] },
        { type: "on_circle", point: "E", circle: "O" }
      ]
    ));
    assert.equal(r.success, true);
  });

  it("accepts DSL for 'triangle ABC with altitude AH'", () => {
    const r = parse(valid(
      [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "H" }
      ],
      [
        { type: "point_on_line", point: "H", line: "BC" },
        { type: "right_angle", points: ["A", "H", "B"] }
      ]
    ));
    assert.equal(r.success, true);
  });

  it("accepts DSL for parallelogram ABCD", () => {
    const r = parse(valid([{ type: "parallelogram", points: ["A", "B", "C", "D"] }]));
    assert.equal(r.success, true);
  });

  it("accepts DSL for equilateral triangle", () => {
    const r = parse(valid([{ type: "equilateral_triangle", points: ["A", "B", "C"] }]));
    assert.equal(r.success, true);
  });
});

// ─── invalid inputs ───────────────────────────────────────────────────────────

describe("dslSchema — invalid inputs", () => {

  it("accepts missing objects array (coerced to [])", () => {
    const r = parse({ constraints: [] });
    assert.equal(r.success, true);
    assert.deepEqual((r as any).data?.objects, []);
  });

  it("accepts missing constraints array (coerced to [])", () => {
    const r = parse({ objects: [] });
    assert.equal(r.success, true);
    assert.deepEqual((r as any).data?.constraints, []);
  });

  it("rejects a point with a lowercase name", () => {
    const r = parse(valid([{ type: "point", name: "a" }]));
    assert.equal(r.success, false, "lowercase point name should fail");
  });

  it("rejects a point with a multi-character name", () => {
    const r = parse(valid([{ type: "point", name: "AB" }]));
    assert.equal(r.success, false, "multi-char point name should fail");
  });

  it("rejects a circle with a negative radius", () => {
    const r = parse(valid([{ type: "circle", center: "O", radius: -1 }]));
    assert.equal(r.success, false);
  });

  it("rejects a triangle with only 2 points", () => {
    const r = parse(valid([{ type: "triangle", points: ["A", "B"] }]));
    assert.equal(r.success, false);
  });

  it("rejects a segment with 3 points", () => {
    const r = parse(valid([{ type: "segment", points: ["A", "B", "C"] }]));
    assert.equal(r.success, false);
  });

  it("rejects a right_angle with 4 points", () => {
    const r = parse(valid([], [{ type: "right_angle", points: ["A", "B", "C", "D"] }]));
    assert.equal(r.success, false);
  });

  it("rejects an equal_length constraint missing one segment", () => {
    const r = parse(valid([], [{ type: "equal_length", segments: [["A", "B"]] }]));
    assert.equal(r.success, false);
  });
});
