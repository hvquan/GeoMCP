/**
 * Tests for Layer 10: src/compiler/construction-compiler.ts
 *
 * dslToGeometryModel() and canonicalToGeometryModel() convert a parsed DSL
 * into a GeometryModel (constraint graph consumed by the layout engine).
 *
 * Uses problem fixtures from resources/tests.txt.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dslToGeometryModel, canonicalToGeometryModel } from "../../src/runtime/compiler.js";
import { dslToCanonical } from "../../src/dsl/canonical.js";
import type { GeometryDsl } from "../../src/dsl/dsl.js";

// ─── fixture helpers ──────────────────────────────────────────────────────────

function dsl(
  objects: GeometryDsl["objects"],
  constraints: GeometryDsl["constraints"] = []
): GeometryDsl {
  return { objects, constraints, constructions: [], targets: [] };
}

// ─── dslToGeometryModel — base shape ─────────────────────────────────────────

describe("dslToGeometryModel — result shape", () => {
  it("returns rawText matching input", () => {
    const m = dslToGeometryModel(dsl([]), "test problem");
    assert.equal(m.rawText, "test problem");
  });

  it("returns arrays for all constraint fields", () => {
    const m = dslToGeometryModel(dsl([]), "");
    assert.ok(Array.isArray(m.points));
    assert.ok(Array.isArray(m.segments));
    assert.ok(Array.isArray(m.circles));
    assert.ok(Array.isArray(m.triangles));
    assert.ok(Array.isArray(m.midpoints));
    assert.ok(Array.isArray(m.perpendiculars));
    assert.ok(Array.isArray(m.altitudes));
    assert.ok(Array.isArray(m.medians));
  });
});

// ─── dslToGeometryModel — points ─────────────────────────────────────────────

describe("dslToGeometryModel — points", () => {
  it("registers a single explicit point", () => {
    const m = dslToGeometryModel(dsl([{ type: "point", name: "A" }]), "");
    assert.ok(m.points.includes("point:A"), `points: ${m.points.join(",")}`);
  });

  it("registers all three vertices of a triangle", () => {
    const m = dslToGeometryModel(dsl([{ type: "triangle", points: ["A", "B", "C"] }]), "");
    assert.ok(m.points.includes("point:A"));
    assert.ok(m.points.includes("point:B"));
    assert.ok(m.points.includes("point:C"));
  });

  // Fixture: "Cho đường tròn (O) có đường kính CD. Lấy điểm E thuộc đường tròn (O)"
  it("registers O, C, D, E for circle + diameter + point-on-circle", () => {
    const m = dslToGeometryModel(dsl(
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
    ), "");
    assert.ok(m.points.includes("point:O") || m.circles.some(c => c.center === "point:O"), "O should be registered");
    assert.ok(m.points.includes("point:E") || m.pointsOnCircles.some(p => p.point === "point:E"));
  });
});

// ─── dslToGeometryModel — circles ────────────────────────────────────────────

describe("dslToGeometryModel — circles", () => {
  it("creates a circle entry for a circle object", () => {
    const m = dslToGeometryModel(dsl([{ type: "circle", center: "O", radius: 5 }]), "");
    assert.ok(m.circles.some(c => c.center === "point:O"), `circles: ${JSON.stringify(m.circles)}`);
  });

  // Fixture: "Cho đường tròn (O) có đường kính CD"
  it("registers diameter constraint for circle with diameter", () => {
    const m = dslToGeometryModel(dsl(
      [
        { type: "circle", name: "O", center: "O" },
        { type: "point", name: "C" },
        { type: "point", name: "D" }
      ],
      [{ type: "diameter", circle: "O", points: ["C", "D"] }]
    ), "");
    const hasDiam =
      m.circlesByDiameter?.some(d => (d.a === "point:C" && d.b === "point:D") || (d.a === "point:D" && d.b === "point:C")) ||
      m.diameterConstraints?.length > 0;
    assert.ok(hasDiam, "expected a diameter constraint");
  });
});

// ─── dslToGeometryModel — triangles ──────────────────────────────────────────

describe("dslToGeometryModel — triangles", () => {
  // Fixture: "Cho tam giác ABC"
  it("registers a triangle for triangle ABC", () => {
    const m = dslToGeometryModel(dsl([{ type: "triangle", points: ["A", "B", "C"] }]), "");
    assert.ok(m.triangles.length > 0, "expected a triangle entry");
    const t = m.triangles[0];
    const verts = [...t.vertices];
    assert.ok(verts.includes("point:A") && verts.includes("point:B") && verts.includes("point:C"));
  });

  // Fixture: "Cho tam giác ABC có đường cao AH"
  it("perpendicular constraint registers a perpendicular or altitude", () => {
    const m = dslToGeometryModel(dsl(
      [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "H" }
      ],
      [{ type: "right_angle", points: ["A", "H", "B"] }]
    ), "");
    const hasPerpOrAlt = m.perpendiculars.length > 0 || m.altitudes.length > 0;
    assert.ok(hasPerpOrAlt, "expected perpendicular or altitude constraint");
  });

  // Fixture: "Cho tam giác ABC có đường trung tuyến AM"
  it("midpoint constraint registers a midpoint", () => {
    const m = dslToGeometryModel(dsl(
      [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "midpoint", point: "M", of: ["B", "C"] }
      ]
    ), "");
    assert.ok(
      m.midpoints.length > 0,
      "expected a midpoint constraint"
    );
  });
});

// ─── dslToGeometryModel — macro expansion ────────────────────────────────────

describe("dslToGeometryModel — macro shapes (desugaring)", () => {
  // Fixture: "parallelogram" (từ Point 11)
  it("parallelogram ABCD registers parallel constraint pairs", () => {
    const m = dslToGeometryModel(dsl([{ type: "parallelogram", points: ["A", "B", "C", "D"] }]), "");
    assert.ok(m.parallels.length >= 2, `expected >= 2 parallel constraints, got ${m.parallels.length}`);
  });

  it("rectangle ABCD registers parallel + perpendicular constraints", () => {
    const m = dslToGeometryModel(dsl([{ type: "rectangle", points: ["A", "B", "C", "D"] }]), "");
    assert.ok(m.parallels.length >= 2);
    assert.ok(m.perpendiculars.length >= 1);
  });

  it("equilateral triangle ABC registers equal_length constraints", () => {
    const m = dslToGeometryModel(dsl([{ type: "equilateral_triangle", points: ["A", "B", "C"] }]), "");
    assert.ok(m.equalLengths.length >= 2, `expected >= 2 equal_length constraints`);
  });
});

// ─── canonicalToGeometryModel ─────────────────────────────────────────────────

describe("canonicalToGeometryModel — via canonical pipeline", () => {
  // Fixture: "Cho đường tròn (O) có đường kính CD. Lấy điểm E thuộc đường tròn (O)"
  it("produces a valid GeometryModel from canonical for circle + diameter + E on circle", () => {
    const input = dsl(
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
    );
    const canonical = dslToCanonical(input);
    const m = canonicalToGeometryModel(canonical, "circle O diameter CD E on circle");
    assert.ok(Array.isArray(m.points));
    assert.ok(m.circles.length > 0 || m.circleConstraints.length > 0, "expected circle data");
  });

  // Fixture: "Cho tam giác ABC"
  it("triangle ABC produces 3 points via canonical pipeline", () => {
    const input = dsl([{ type: "triangle", points: ["A", "B", "C"] }]);
    const canonical = dslToCanonical(input);
    const m = canonicalToGeometryModel(canonical, "Triangle ABC");
    assert.ok(m.points.includes("point:A") || m.points.some(p => p === "point:A"));
    assert.ok(m.points.includes("point:B") || m.points.some(p => p === "point:B"));
    assert.ok(m.points.includes("point:C") || m.points.some(p => p === "point:C"));
  });

  it("produces rawText matching input", () => {
    const canonical = dslToCanonical(dsl([{ type: "point", name: "A" }]));
    const m = canonicalToGeometryModel(canonical, "my problem");
    assert.equal(m.rawText, "my problem");
  });

  it("result has all required GeometryModel fields", () => {
    const canonical = dslToCanonical(dsl([]));
    const m = canonicalToGeometryModel(canonical, "");
    for (const field of ["points", "segments", "circles", "triangles", "perpendiculars", "parallels"]) {
      assert.ok(Array.isArray((m as any)[field]), `missing array field: ${field}`);
    }
  });
});
